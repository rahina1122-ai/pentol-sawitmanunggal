import { Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import zlib from 'zlib';

const envPath = join(process.cwd(), '.env');
let sdkAppId: number | undefined;
let secretKey: string | undefined;
let databaseUrl: string | undefined;

try {
  const envContent = readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach((line) => {
    const [key, ...values] = line.split('=');
    if (key && values.length > 0) {
      const k = key.trim();
      const v = values.join('=').trim();
      if (!(k in process.env)) {
        process.env[k] = v;
      }
    }
  });
} catch {}

if (process.env.TENCENT_SDK_APP_ID) {
  sdkAppId = Number(process.env.TENCENT_SDK_APP_ID);
}
secretKey = process.env.TENCENT_SDK_SECRET_KEY;
databaseUrl = process.env.DATABASE_URL;

if (!sdkAppId || !secretKey || !databaseUrl) {
  console.error('Missing TENCENT_SDK_APP_ID, TENCENT_SDK_SECRET_KEY, or DATABASE_URL in env');
  process.exit(1);
}

const base64UrlEncode = (buf: Buffer) => {
  return buf
    .toString('base64')
    .replace(/\+/g, '*')
    .replace(/\//g, '-')
    .replace(/=/g, '_');
};

const genUserSig = (userId: string, expireSeconds: number) => {
  const currTime = Math.floor(Date.now() / 1000);
  const sigDoc: any = {
    'TLS.ver': '2.0',
    'TLS.identifier': userId,
    'TLS.sdkappid': sdkAppId,
    'TLS.time': currTime,
    'TLS.expire': expireSeconds,
  };

  const content =
    'TLS.identifier:' +
    userId +
    '\nTLS.sdkappid:' +
    sdkAppId +
    '\nTLS.time:' +
    currTime +
    '\nTLS.expire:' +
    expireSeconds +
    '\n';

  const sign = crypto.createHmac('sha256', secretKey as string).update(content).digest('base64');
  sigDoc['TLS.sig'] = sign;

  const json = Buffer.from(JSON.stringify(sigDoc));
  const compressed = zlib.deflateSync(json);
  return base64UrlEncode(compressed);
};

const main = async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT id FROM public.profiles ORDER BY id',
    );

    if (rows.length === 0) {
      console.log('No profiles without tencent_usersig');
      return;
    }

    const expire = 7 * 24 * 60 * 60;

    for (const row of rows) {
      const userId: string = row.id;
      const userSig = genUserSig(userId, expire);
      await client.query(
        'UPDATE public.profiles SET tencent_usersig = $1 WHERE id = $2',
        [userSig, userId],
      );
      console.log('Generated userSig for', userId);
    }
  } finally {
    client.release();
  }
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
