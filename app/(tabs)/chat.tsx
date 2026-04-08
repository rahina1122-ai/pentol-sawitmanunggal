import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, SafeAreaView, ScrollView, TouchableOpacity, Image, Alert, Platform, TextInput, KeyboardAvoidingView } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { 
  ConversationList, 
  Chat, 
  ChatSetting,
  UIKitProvider
} from '@tencentcloud/chat-uikit-react-native';
import { TUILogin } from '@tencentcloud/tui-core';
import { TUIConversationService } from '@tencentcloud/chat-uikit-engine';
import { useTranslation } from 'react-i18next';
import { getDbClient } from '@/lib/db';
import TencentCloudChat from '@tencentcloud/chat';
import TIMUploadPlugin from 'tim-upload-plugin';
import NetInfo from '@react-native-community/netinfo';

const SDKAPPID = 20033409;

export default function ChatScreen() {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [chatReady, setChatReady] = useState(false);
  const [currentView, setCurrentView] = useState<'conversation' | 'chat' | 'setting'>('conversation');
  const [userDirectory, setUserDirectory] = useState<Array<{ id: string; full_name: string | null; role: string; photo_url: string | null }>>([]);
  const [userDirectoryLoading, setUserDirectoryLoading] = useState(false);
  const [webChat, setWebChat] = useState<any | null>(null);
  const [webSelectedUserId, setWebSelectedUserId] = useState<string | null>(null);
  const [webMessages, setWebMessages] = useState<any[]>([]);
  const [webInput, setWebInput] = useState('');
  const webScrollRef = useRef<any>(null);
  const [incomingNotification, setIncomingNotification] = useState<{ fromId: string; fromName: string | null; text: string } | null>(null);

  useEffect(() => {
    if (user?.id) {
      if (Platform.OS === 'web') {
        initChatWeb(user.id);
      } else {
        initChat(user.id);
      }
      loadUserDirectory(user.id);
    }
  }, [user, profile?.id]);

  useEffect(() => {
    if (!webChat) return;

    const handleMessageReceived = (event: any) => {
      const list = event.data?.messageList || [];
      list.forEach((m: any) => {
        const conversationID = m.conversationID || '';
        const isC2C = conversationID.startsWith('C2C');
        const peerId = isC2C ? conversationID.slice(3) : null;

        if (webSelectedUserId && conversationID === `C2C${webSelectedUserId}`) {
          setWebMessages(prev => [...prev, m]);
        }

        if (!peerId) {
          return;
        }

        if (m.from && user && m.from === user.id) {
          return;
        }

        const profileMatch = userDirectory.find((u) => u.id === (m.from || peerId));
        const fromId = profileMatch?.id || m.from || peerId;
        const fromName = profileMatch?.full_name || null;
        const text = m.payload?.text || '';

        setIncomingNotification({
          fromId,
          fromName,
          text,
        });
      });
    };

    webChat.on(TencentCloudChat.EVENT.MESSAGE_RECEIVED, handleMessageReceived);

    return () => {
      webChat.off(TencentCloudChat.EVENT.MESSAGE_RECEIVED, handleMessageReceived);
    };
  }, [webChat, webSelectedUserId, user, userDirectory]);

  const loadUserDirectory = async (currentUserId: string) => {
    try {
      setUserDirectoryLoading(true);
      const db = await getDbClient();
      const { rows } = await db.query(
        'SELECT id, full_name, role, photo_url FROM profiles WHERE id <> $1 ORDER BY full_name NULLS LAST, email ASC',
        [currentUserId],
      );
      setUserDirectory(rows as any);
    } catch (error) {
      console.error('Gagal memuat daftar user untuk chat:', error);
    } finally {
      setUserDirectoryLoading(false);
    }
  };

  const startPrivateChat = async (targetUserId: string) => {
    if (!chatReady) {
      Alert.alert(
        t('chat.engine_not_ready_title', 'Chat belum siap'),
        t(
          'chat.engine_not_ready_message',
          'Backend TUIKit belum berhasil login. Chat baru bisa aktif setelah konfigurasi UserSig selesai.',
        ),
      );
      return;
    }

    try {
      const conversationID = `C2C${targetUserId}`;
      const { chat } = TUILogin.getContext();
      
      if (!chat) {
        throw new Error('Chat engine context not found');
      }

      // Pastikan SDK benar-benar siap (login selesai di level engine)
      // Jika switchConversation dipanggil terlalu cepat setelah TUILogin.login, 
      // engine mungkin belum selesai inisialisasi internal (TUIChatEngine).
      
      try {
        await chat.getConversationProfile(conversationID);
      } catch (syncError) {
        console.warn('Gagal sinkronisasi profil percakapan (mungkin belum siap):', syncError);
      }

      await TUIConversationService.switchConversation(conversationID);
      setCurrentView('chat');
    } catch (error: any) {
      console.error('Gagal membuka percakapan privat:', error);
      
      // Jika error karena inisialisasi belum selesai, beri tahu user untuk menunggu sejenak
      if (error?.message?.includes('初始化未完成') || error?.code === -100000) {
        Alert.alert(
          t('chat.initializing_title', 'Sedang Menyiapkan'),
          t('chat.initializing_wait', 'Chat sedang dalam proses inisialisasi, harap tunggu sebentar dan coba lagi.'),
        );
      } else {
        Alert.alert(
          t('chat.open_conversation_error_title', 'Tidak bisa membuka chat'),
          t(
            'chat.open_conversation_error_message',
            'Percakapan dengan user ini belum tersedia di server chat. Pastikan user sudah terdaftar di Tencent Chat.',
          ),
        );
      }
    }
  };

  const initChatWeb = async (userId: string) => {
    try {
      setLoading(true);
      setChatReady(false);

      let chatUserId = userId;
      let userSig: string | null = null;

      // Ambil UserSig dari database
      try {
        const db = await getDbClient();
        const { rows } = await db.query(
          'SELECT id, tencent_usersig FROM profiles WHERE id = $1',
          [userId],
        );
        if (rows.length > 0) {
          const row: any = rows[0];
          chatUserId = row.id;
          if (row.tencent_usersig && typeof row.tencent_usersig === 'string') {
            userSig = row.tencent_usersig;
          }
        }
      } catch (err) {
        console.error('Gagal mengambil UserSig dari Neon (web):', err);
      }

      if (!userSig) {
        console.warn('Peringatan: userSig tidak ditemukan untuk user (web):', chatUserId);
        setLoading(false);
        Alert.alert(
          t('chat.usersig_missing_title', 'Chat belum dikonfigurasi'),
          t('chat.usersig_missing_message', 'UserSig untuk akun ini belum tersedia di database.'),
        );
        return;
      }

      const chat = TencentCloudChat.create({
        SDKAppID: SDKAPPID,
      });
      chat.registerPlugin({ 'tim-upload-plugin': TIMUploadPlugin });
      await chat.login({
        userID: chatUserId,
        userSig,
      });

      setWebChat(chat);
      setChatReady(true);
    } catch (error) {
      console.error('Gagal inisialisasi chat web:', error);
      setChatReady(false);
      Alert.alert(
        t('chat.init_failed_title', 'Gagal menyiapkan chat'),
        t(
          'chat.init_failed_message',
          'Terjadi kesalahan saat login ke TUIKit. Periksa kembali konfigurasi SDKAppID, userID, dan UserSig.',
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const startWebPrivateChat = async (targetUserId: string) => {
    if (!webChat) {
      Alert.alert(
        t('chat.engine_not_ready_title', 'Chat belum siap'),
        t(
          'chat.engine_not_ready_message',
          'Backend TUIKit belum berhasil login. Chat baru bisa aktif setelah konfigurasi UserSig selesai.',
        ),
      );
      return;
    }

    try {
      const conversationID = `C2C${targetUserId}`;
      const res = await webChat.getMessageList({ conversationID });
      const list = res.data?.messageList || [];
      setWebSelectedUserId(targetUserId);
      setWebMessages(list);
    } catch (error) {
      console.error('Gagal memuat pesan web:', error);
      Alert.alert(
        t('chat.open_conversation_error_title', 'Tidak bisa membuka chat'),
        t(
          'chat.open_conversation_error_message',
          'Terjadi kesalahan saat membuka percakapan di web.',
        ),
      );
    }
  };

  const sendWebMessage = async () => {
    if (!webChat || !webSelectedUserId || !webInput.trim()) {
      return;
    }
    try {
      const message = webChat.createTextMessage({
        to: webSelectedUserId,
        conversationType: TencentCloudChat.TYPES.CONV_C2C,
        payload: { text: webInput },
      });
      await webChat.sendMessage(message);
      setWebMessages(prev => [...prev, message]);
      setWebInput('');
    } catch (error) {
      console.error('Gagal mengirim pesan web:', error);
    }
  };

  const handleWebImageChange = async (event: any) => {
    if (!webChat || !webSelectedUserId) {
      return;
    }
    const file = event?.target?.files?.[0];
    if (!file) {
      return;
    }
    try {
      const message = webChat.createImageMessage({
        to: webSelectedUserId,
        conversationType: TencentCloudChat.TYPES.CONV_C2C,
        payload: { file },
      });
      await webChat.sendMessage(message);
      setWebMessages(prev => [...prev, message]);
    } catch (error) {
      console.error('Gagal mengirim gambar web:', error);
    } finally {
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const initChat = async (userId: string) => {
    try {
      setLoading(true);
      setChatReady(false);

      let chatUserId = userId;
      let userSig: string | null = null;

      console.log('Inisialisasi chat untuk user:', userId);

      // Ambil UserSig dari database
      try {
        const db = await getDbClient();
        const { rows } = await db.query(
          'SELECT id, tencent_usersig FROM profiles WHERE id = $1',
          [userId],
        );
        if (rows.length > 0) {
          const row: any = rows[0];
          chatUserId = row.id;
          if (row.tencent_usersig && typeof row.tencent_usersig === 'string') {
            userSig = row.tencent_usersig;
            console.log('UserSig ditemukan di database');
          }
        } else {
          console.warn('Profil tidak ditemukan di database untuk ID:', userId);
        }
      } catch (err) {
        console.error('Gagal mengambil UserSig dari Neon:', err);
      }

      if (!userSig) {
        console.warn('Peringatan: userSig tidak ditemukan untuk user:', chatUserId);
        setLoading(false);
        Alert.alert(
          t('chat.usersig_missing_title', 'Chat belum dikonfigurasi'),
          t('chat.usersig_missing_message', 'UserSig untuk akun ini belum tersedia di database.'),
        );
        return;
      }

      console.log('Mencoba login ke TUILogin...');
      await TUILogin.login({
        SDKAppID: SDKAPPID,
        userID: chatUserId,
        userSig: userSig,
        framework: 'rn'
      });

      try {
        const displayName = profile?.full_name || user?.email || chatUserId;
        const { chat } = TUILogin.getContext();
        if (chat) {
          chat.registerPlugin({
            'tim-upload-plugin': TIMUploadPlugin,
            'chat-network-monitor': NetInfo,
          });
          if (displayName) {
            await chat.updateMyProfile({
              nick: displayName,
            });
          }
        }
      } catch (profileError) {
        console.error('Gagal mengupdate profil chat:', profileError);
      }

      console.log('TUIKit Login Berhasil');
      setChatReady(true);
    } catch (error: any) {
      console.error('Gagal inisialisasi TUIKit:', error);
      setChatReady(false);
      Alert.alert(
        t('chat.init_failed_title', 'Gagal menyiapkan chat'),
        t('chat.init_failed_message', 'Terjadi kesalahan saat login ke TUIKit: ') + (error?.message || error || ''),
      );
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text>{t('auth.please_login', 'Silakan login untuk menggunakan chat.')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2d5016" />
          <Text style={styles.loadingText}>{t('chat.initializing', 'Menyiapkan Chat...')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.userPickerContainer}>
          <Text style={styles.userPickerTitle}>
            {t('chat.user_picker_title', 'Pilih pengguna untuk memulai chat')}
          </Text>
          {userDirectoryLoading ? (
            <ActivityIndicator size="small" color="#2d5016" />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.userPickerScroll}
            >
              {userDirectory.map((u) => (
                <TouchableOpacity
                  key={u.id}
                  style={styles.userChip}
                  onPress={() => startWebPrivateChat(u.id)}
                >
                  {u.photo_url ? (
                    <Image source={{ uri: u.photo_url }} style={styles.userAvatar} />
                  ) : (
                    <View style={styles.userAvatarPlaceholder}>
                      <Text style={styles.userAvatarInitial}>
                        {(u.full_name || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text numberOfLines={1} style={styles.userName}>
                    {u.full_name || u.id}
                  </Text>
                  <Text numberOfLines={1} style={styles.userRole}>
                    {u.role}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
        {incomingNotification && (
          <TouchableOpacity
            style={styles.webNotification}
            onPress={() => {
              const targetId = incomingNotification.fromId;
              setIncomingNotification(null);
              if (targetId) {
                startWebPrivateChat(targetId);
              }
            }}
          >
            <Text style={styles.webNotificationTitle}>
              {incomingNotification.fromName || incomingNotification.fromId}
            </Text>
            {!!incomingNotification.text && (
              <Text
                numberOfLines={1}
                style={styles.webNotificationText}
              >
                {incomingNotification.text}
              </Text>
            )}
          </TouchableOpacity>
        )}
        <View style={styles.webChatContainer}>
          {webSelectedUserId ? (
            <>
              <View style={styles.webMessagesContainer}>
                <ScrollView
                  ref={webScrollRef}
                  contentContainerStyle={styles.webMessagesScroll}
                  onContentSizeChange={() => {
                    if (webScrollRef.current && typeof webScrollRef.current.scrollToEnd === 'function') {
                      webScrollRef.current.scrollToEnd({ animated: true });
                    }
                  }}
                >
                  {webMessages.map((m, index) => (
                    <View key={m.ID || m.clientSequence || index} style={styles.webMessageBubble}>
                      <Text style={styles.webMessageText}>
                        {m.payload?.text || ''}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.webInputRow}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleWebImageChange}
                  style={{ marginRight: 8 }}
                />
                <TextInput
                  style={styles.webInput}
                  value={webInput}
                  onChangeText={setWebInput}
                  placeholder={t('chat.input_placeholder', 'Tulis pesan...')}
                />
                <TouchableOpacity
                  style={styles.webSendButton}
                  onPress={sendWebMessage}
                  disabled={!webInput.trim()}
                >
                  <Text style={styles.webSendText}>{t('chat.send', 'Kirim')}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.center}>
              <Text style={styles.loadingText}>
                {t('chat.select_user_hint', 'Pilih pengguna di atas untuk mulai chat.')}
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <UIKitProvider>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoiding}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.userPickerContainer}>
            <Text style={styles.userPickerTitle}>
              {t('chat.user_picker_title', 'Pilih pengguna untuk memulai chat')}
            </Text>
            {userDirectoryLoading ? (
              <ActivityIndicator size="small" color="#2d5016" />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.userPickerScroll}
              >
                {userDirectory.map((u) => (
                  <TouchableOpacity
                    key={u.id}
                    style={styles.userChip}
                    onPress={() => startPrivateChat(u.id)}
                  >
                    {u.photo_url ? (
                      <Image source={{ uri: u.photo_url }} style={styles.userAvatar} />
                    ) : (
                      <View style={styles.userAvatarPlaceholder}>
                        <Text style={styles.userAvatarInitial}>
                          {(u.full_name || '?').charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <Text numberOfLines={1} style={styles.userName}>
                      {u.full_name || u.id}
                    </Text>
                    <Text numberOfLines={1} style={styles.userRole}>
                      {u.role}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
          <View style={styles.mobileContent}>
            {currentView === 'conversation' && (
              <ConversationList 
                onPressConversation={() => setCurrentView('chat')}
              />
            )}
            
            {currentView === 'chat' && (
              <Chat 
                navigateBack={() => setCurrentView('conversation')}
                navigateToChatSetting={() => setCurrentView('setting')}
              />
            )}

            {currentView === 'setting' && (
              <ChatSetting 
                navigateBack={() => setCurrentView('chat')}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </UIKitProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  userPickerContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
  userPickerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  userPickerScroll: {
    paddingBottom: 8,
  },
  mobileContent: {
    flex: 1,
  },
  keyboardAvoiding: {
    flex: 1,
  },
  userChip: {
    width: 90,
    marginRight: 12,
    alignItems: 'center',
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: 4,
    backgroundColor: '#e0e0e0',
  },
  userAvatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#c5e1a5',
  },
  userAvatarInitial: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2d5016',
  },
  userName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  userRole: {
    fontSize: 10,
    color: '#777',
    textAlign: 'center',
  },
  webNotification: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#e8f5e9',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#a5d6a7',
  },
  webNotificationTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1b5e20',
    marginBottom: 4,
  },
  webNotificationText: {
    fontSize: 12,
    color: '#2e7d32',
  },
  webChatContainer: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  webMessagesContainer: {
    flex: 1,
  },
  webMessagesScroll: {
    padding: 12,
  },
  webMessageBubble: {
    alignSelf: 'flex-start',
    maxWidth: '80%',
    marginBottom: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
  },
  webMessageText: {
    fontSize: 14,
    color: '#333',
  },
  webInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#ffffff',
  },
  webInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cccccc',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    fontSize: 14,
    backgroundColor: '#ffffff',
  },
  webSendButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#2d5016',
  },
  webSendText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});
