import { Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import fetch from 'node-fetch';

const envPath = join(process.cwd(), '.env');
let sdkAppId: number | undefined;
let secretKey: string | undefined;
let databaseUrl: string | undefined;
let adminIdentifier: string | undefined;

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
adminIdentifier = process.env.TENCENT_ADMIN_IDENTIFIER;

if (!sdkAppId || !secretKey || !databaseUrl || !adminIdentifier) {
  console.error(
    'Missing TENCENT_SDK_APP_ID, TENCENT_SDK_SECRET_KEY, TENCENT_ADMIN_IDENTIFIER, or DATABASE_URL in env',
  );
  process.exit(1);
}

const base64UrlEncode = (buf: Buffer) => {
  return buf
    .toString('base64')
    .replace(/\+/g, '*')
    .replace(/\//g, '-')
    .replace(/=/g, '_');
};

const genUserSig = (identifier: string, expireSeconds: number) => {
  const currTime = Math.floor(Date.now() / 1000);
  const sigDoc: any = {
    'TLS.ver': '2.0',
    'TLS.identifier': identifier,
    'TLS.sdkappid': sdkAppId,
    'TLS.time': currTime,
    'TLS.expire': expireSeconds,
  };

  const content =
    'TLS.identifier:' +
    identifier +
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

const importAccount = async (adminSig: string, userId: string, nick: string | null) => {
  const url = new URL('https://console.tim.qq.com/v4/im_open_login_svc/account_import');
  url.searchParams.set('sdkappid', String(sdkAppId));
  url.searchParams.set('identifier', adminIdentifier as string);
  url.searchParams.set('usersig', adminSig);
  url.searchParams.set('random', String(Math.floor(Math.random() * 100000000)));
  url.searchParams.set('contenttype', 'json');

  const body = {
    UserID: userId,
    Nick: nick || userId,
  };

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} importing account ${userId}`);
  }

  const data = (await res.json()) as { ErrorCode: number; ErrorInfo?: string };

  if (data.ErrorCode === 0 || data.ErrorCode === 70163) {
    return;
  }

  throw new Error(
    `Tencent account_import failed for ${userId}: ${data.ErrorCode} ${data.ErrorInfo || ''}`,
  );
};

const main = async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      'SELECT id, full_name FROM public.profiles ORDER BY id',
    );

    if (rows.length === 0) {
      console.log('No profiles found to import');
      return;
    }

    const adminSig = genUserSig(adminIdentifier as string, 60 * 60);

    for (const row of rows) {
      const userId: string = row.id;
      const fullName: string | null = row.full_name || null;
      try {
        await importAccount(adminSig, userId, fullName);
        console.log('Imported Tencent account for', userId);
      } catch (err) {
        console.error('Failed to import account for', userId, '-', (err as Error).message);
      }
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

