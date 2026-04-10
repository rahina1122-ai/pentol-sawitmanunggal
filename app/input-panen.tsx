import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
  Modal,
} from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { getDbClient } from '@/lib/db';
import { useOfflineData, runCommand, syncHarvestQueue, syncMasterData } from '@/lib/offline';
import { ChevronLeft, Save, X, Check, Calendar, Image as ImageIcon, WifiOff } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';

import { useTranslation } from 'react-i18next';
import Dropdown from '@/components/Dropdown';
import MultiSelectDropdown from '@/components/MultiSelectDropdown';
import EditableDropdown from '@/components/EditableDropdown';

interface Divisi {
  id: string;
  name: string;
  estate_name: string;
}

interface Blok {
  id: string;
  name: string;
  tahun_tanam: number;
}

interface Pemanen {
  id: string;
  operator_code: string;
  name: string;
  gang_id: string;
}

interface TPH {
  id: string;
  nomor_tph: string;
}

interface Gang {
  id: string;
  name: string;
}

const getFormattedDate = (dateString: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const dateStr = date.toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${dateStr}, Waktu: ${timeStr}`;
};

export default function InputPanenScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const { profile, session, user, loading: authLoading } = useAuth();
  const { isOffline, getDivisi, getGang, getBlok, getPemanen, getTPH } = useOfflineData();
  const [loading, setLoading] = useState(false);
  const [isFetchingData, setIsFetchingData] = useState(false); // State for loading indicator
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    // Initial sync
    const performInitialSync = async () => {
      try {
        await syncMasterData();
        console.log('Initial master data sync complete');
        // Refresh local lists after sync
        loadDivisiList();
        if (formData.divisi_id) {
          loadDivisiData(formData.divisi_id);
        }
      } catch (err) {
        console.error('Initial sync master failed:', err);
      }
      
      try {
        await syncHarvestQueue();
      } catch (err) {
        console.error('Initial sync queue failed:', err);
      }
    };

    performInitialSync();

    // Trigger sync when connection is restored
    const unsubscribeNet = NetInfo.addEventListener((state: any) => {
      if (state.isConnected) {
        console.log('Connection restored, triggering sync...');
        syncHarvestQueue().catch(err => console.error('Auto-sync after reconnect failed:', err));
      }
    });

    // Set up periodic sync every 5 minutes
    const syncInterval = setInterval(async () => {
      const state = await NetInfo.fetch();
      if (state.isConnected) {
        console.log('Performing periodic background sync...');
        syncMasterData().catch(err => console.error('Periodic master sync failed:', err));
        syncHarvestQueue().catch(err => console.error('Periodic queue sync failed:', err));
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => {
      clearInterval(syncInterval);
      unsubscribeNet();
    };
  }, []);

  const dataCache = useRef<Record<string, {
    gang: Gang[],
    blok: Blok[],
    pemanen: Pemanen[],
    tph: TPH[]
  }>>({});
  const [divisiList, setDivisiList] = useState<Divisi[]>([]);
  const [blokList, setBlokList] = useState<Blok[]>([]);
  const [pemanenList, setPemanenList] = useState<Pemanen[]>([]);
  const [tphList, setTphList] = useState<TPH[]>([]);
  const [gangList, setGangList] = useState<Gang[]>([]);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    tanggal: new Date().toISOString().split('T')[0],
    divisi_id: profile?.divisi_id || '',
    tahun_tanam: '',
    gang_id: '',
    blok_ids: [] as string[],
    blok_name: '', // Added for EditableDropdown
    pemanen_id: '',
    tph_id: '',
    rotasi: '',
    nomor_panen: '',
    hasil_panen_bjd: '',
    jumlah_brondolan_kg: '',
    bjr: '',
    buah_masak: '',
    buah_mentah: '',
    buah_mengkal: '',
    overripe: '',
    abnormal: '',
    buah_busuk: '',
    tangkai_panjang: '',
    jangkos: '',
    keterangan: '',
  });

  useEffect(() => {
    console.log('InputPanenScreen mounted v2 (Neon DB Upload Active)', profile);
    loadDivisiList();

    // Load data divisi user saat mount
    const divisiId = formData.divisi_id || profile?.divisi_id;
    if (divisiId) {
      if (!formData.divisi_id && profile?.divisi_id) {
        setFormData(prev => ({ 
          ...prev, 
          divisi_id: profile.divisi_id!,
          gang_id: profile.gang_id || prev.gang_id 
        }));
      }
      loadDivisiData(divisiId);
    }
  }, [profile]);

  useEffect(() => {
    // Load data ketika divisi berubah
    if (formData.divisi_id && formData.divisi_id !== profile?.divisi_id) {
      loadDivisiData(formData.divisi_id);
    }
  }, [formData.divisi_id]);

  const loadDivisiList = async () => {
    try {
      const rows = await getDivisi();
      console.log('Loaded divisi:', rows?.length);
      setDivisiList(rows as any[]);
    } catch (error) {
      console.error('Error loading divisi list:', error);
    }
  };

  const loadDivisiData = async (divisiId: string) => {
    if (!divisiId) return;

    // Check cache first
    if (dataCache.current[divisiId]) {
      console.log('Loading data from cache for divisi:', divisiId);
      const cached = dataCache.current[divisiId];
      setGangList(cached.gang);
      setBlokList(cached.blok);
      setPemanenList(cached.pemanen);
      setTphList(cached.tph);
      return;
    }

    setIsFetchingData(true);
    try {
      console.log('Loading data for divisi:', divisiId);
      
      const [gangList, blokList, pemanenList, tphList] = await Promise.all([
        getGang(divisiId),
        getBlok(divisiId),
        getPemanen(divisiId),
        getTPH(divisiId)
      ]);

      const newGangList = (gangList || []) as any[];
      const newBlokList = (blokList || []) as any[];
      const newPemanenList = (pemanenList || []) as any[];
      const newTphList = (tphList || []) as any[];

      setGangList(newGangList);
      setBlokList(newBlokList);
      setPemanenList(newPemanenList);
      setTphList(newTphList);

      // Save to cache
      dataCache.current[divisiId] = {
        gang: newGangList,
        blok: newBlokList,
        pemanen: newPemanenList,
        tph: newTphList
      };

      console.log('Loaded data:', {
        gang: newGangList.length,
        blok: newBlokList.length,
        pemanen: newPemanenList.length,
        tph: newTphList.length,
      });
    } catch (error) {
      console.error('Error loading divisi data:', error);
      Alert.alert(
        'Error Loading Data',
        'Gagal memuat data divisi. Silakan coba lagi.',
        [
          { text: 'Batal', style: 'cancel' },
          { text: 'Coba Lagi', onPress: () => loadDivisiData(divisiId) }
        ]
      );
    } finally {
      setIsFetchingData(false);
    }
  };

  const saveToOfflineQueue = async (finalBlokIds: string[], userId: string) => {
    const jjg = parseFloat(formData.hasil_panen_bjd) || 0;
    const bjr = parseInt(formData.bjr) || 0;
    const bjd = jjg * bjr;
    
    let localPhotoPath = null;
    if (photoUri) {
        try {
            const filename = photoUri.split('/').pop() || `photo_${Date.now()}.jpg`;
            const harvestDir = ((FileSystem as any).documentDirectory || '') + 'harvest_photos/';
            
            const dirInfo = await FileSystem.getInfoAsync(harvestDir);
            if (!dirInfo.exists) {
                await FileSystem.makeDirectoryAsync(harvestDir, { intermediates: true });
            }
            
            const destPath = harvestDir + filename;
            await FileSystem.copyAsync({
                from: photoUri,
                to: destPath
            });
            
            localPhotoPath = destPath;
            console.log('Photo saved to local storage:', localPhotoPath);
        } catch (photoError) {
            console.error('Error saving photo to local storage:', photoError);
        }
    }

    for (const blokId of finalBlokIds) {
         await runCommand(`
             INSERT INTO harvest_records_queue (
                 tanggal, divisi_id, blok_id, pemanen_id, tph_id, rotasi,
                 hasil_panen_bjd, bjr, buah_masak, buah_mentah, buah_mengkal,
                 overripe, abnormal, buah_busuk, tangkai_panjang, jangkos,
                 keterangan, status, created_by, nomor_panen, jumlah_jjg,
                 foto_path, jumlah_brondolan_kg
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         `, [
             formData.tanggal || '',
             formData.divisi_id || '',
             blokId || '',
             formData.pemanen_id || '',
             formData.tph_id || null,
             parseInt(formData.rotasi) || 0,
             bjd || 0,
             bjr || 0,
             parseInt(formData.buah_masak) || 0,
             parseInt(formData.buah_mentah) || 0,
             parseInt(formData.buah_mengkal) || 0,
             parseInt(formData.overripe) || 0,
             parseInt(formData.abnormal) || 0,
             parseInt(formData.buah_busuk) || 0,
             parseInt(formData.tangkai_panjang) || 0,
             parseInt(formData.jangkos) || 0,
             formData.keterangan || null,
             'pending',
             userId || '',
             formData.nomor_panen || '',
             jjg || 0,
             localPhotoPath || null,
             parseFloat(formData.jumlah_brondolan_kg) || 0
         ]);
    }
    
    setSuccessMessage(`${finalBlokIds.length} ${t('input.success.offlineSaved')}`);
    setShowSuccessModal(true);
  };

  const handleSubmit = async () => {
    if (!formData.divisi_id) {
      Alert.alert(t('common.error'), t('input.error.selectDivision'));
      return;
    }
    
    // Validate Blok Name and resolve to ID
    if (!formData.blok_name) {
      Alert.alert(t('common.error'), t('input.error.selectBlock'));
      return;
    }
    
    const selectedBlok = blokList.find(b => b.name === formData.blok_name);
    if (!selectedBlok) {
      Alert.alert(t('common.error'), t('input.error.invalidBlock'));
      return;
    }
    
    // Set blok_ids for the loop
    const finalBlokIds = [selectedBlok.id];

    if (!formData.pemanen_id) {
      Alert.alert(t('common.error'), t('input.error.selectHarvester'));
      return;
    }
    if (!formData.rotasi) {
      Alert.alert(t('common.error'), t('input.error.fillRotation'));
      return;
    }
    if (!formData.hasil_panen_bjd) {
      Alert.alert(t('common.error'), t('input.error.fillYield'));
      return;
    }

    setLoading(true);
    console.log('Submitting harvest data...', formData);

    try {
      const userId = profile?.id || user?.id || session?.userId;
      if (!userId) {
        throw new Error(t('input.error.sessionLost'));
      }

      // Check if actually online by attempting to get the DB client
      if (isOffline) {
        console.log('App is in offline mode, saving to local queue...');
        await saveToOfflineQueue(finalBlokIds, userId);
        setLoading(false);
        return;
      }

      // Try Online Submission
      try {
        let uploadedPhotoUrl = null;
        if (photoUri) {
          setUploadingPhoto(true);
          uploadedPhotoUrl = await uploadPhotoToStorage(photoUri);
          setUploadingPhoto(false);
          
          if (!uploadedPhotoUrl) {
              console.warn('Photo upload failed or returned null');
          }
        }

        console.log('Connecting to database...');
        const db = await getDbClient();
        console.log('Database connected');
        
        await db.query('BEGIN');
        
        const jjg = parseFloat(formData.hasil_panen_bjd) || 0;
        const bjr = parseInt(formData.bjr) || 0;
        const bjd = jjg * bjr; // Calculate total weight based on JJG * BJR
        const totalRecords = finalBlokIds.length;
        let insertedCount = 0;

        console.log(`Preparing to insert ${totalRecords} records...`);

        for (const blokId of finalBlokIds) {
             await db.query(`
               INSERT INTO harvest_records (
                  tanggal, divisi_id, blok_id, pemanen_id, tph_id, rotasi,
                  hasil_panen_bjd, bjr, buah_masak, buah_mentah, buah_mengkal,
                  overripe, abnormal, buah_busuk, tangkai_panjang, jangkos,
                  keterangan, status, created_by, nomor_panen, jumlah_jjg,
                  foto_url, jumlah_brondolan_kg
               ) VALUES (
                  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
                  $22, $23
               )
             `, [
               formData.tanggal || '',
               formData.divisi_id || '', 
               blokId || '',
               formData.pemanen_id || '',
               formData.tph_id || null,
               parseInt(formData.rotasi) || 0,
               bjd || 0, 
               bjr || 0,
               parseInt(formData.buah_masak) || 0,
               parseInt(formData.buah_mentah) || 0,
               parseInt(formData.buah_mengkal) || 0,
               parseInt(formData.overripe) || 0,
               parseInt(formData.abnormal) || 0,
               parseInt(formData.buah_busuk) || 0,
               parseInt(formData.tangkai_panjang) || 0,
               parseInt(formData.jangkos) || 0,
               formData.keterangan || null,
               'submitted',
               userId || '',
               formData.nomor_panen || '',
               jjg || 0, 
               uploadedPhotoUrl || null,
               parseFloat(formData.jumlah_brondolan_kg) || 0
             ]);
             insertedCount++;
        }
        
        await db.query('COMMIT');
        await db.end();
        console.log(`Successfully inserted ${insertedCount} records`);

        setSuccessMessage(t('input.success.saveSuccess', { count: insertedCount }));
        setShowSuccessModal(true);
      } catch (onlineError: any) {
        console.error('Online saving failed, falling back to offline queue:', onlineError);
        // Automatically switch to offline if online fails
        await saveToOfflineQueue(finalBlokIds, userId);
      }

    } catch (error: any) {
      console.error('Error saving harvest (Global Catch):', error);
      Alert.alert(t('common.error'), t('input.error.saveFailed', { error: error.message || 'Unknown error' }));
    } finally {
      setLoading(false);
      setUploadingPhoto(false);
    }
  };

  const updateField = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePickImage = () => {
    handleTakeImage();
  };

  const handleLaunchLibrary = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled) {
        setPhotoUri(result.assets[0].uri);
        setPhotoBase64(result.assets[0].base64 || null);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert(t('common.error'), t('input.error.pickImage'));
    }
  };

  const handleTakeImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      if (permissionResult.granted === false) {
        Alert.alert(t('input.error.cameraPermissionDenied'), t('input.error.cameraPermissionRequired'));
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled) {
        setPhotoUri(result.assets[0].uri);
        setPhotoBase64(result.assets[0].base64 || null);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert(t('input.error.title'), t('input.error.takeImage'));
    }
  };

  const handleBack = () => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/mandor');
    }
  };

  const handleRemovePhoto = () => {
    setPhotoUri(null);
    setPhotoBase64(null);
  };

  const uploadPhotoToStorage = async (uri: string): Promise<string | null> => {
    if (!photoBase64) {
      console.warn("No base64 data available for upload");
      // Fallback if base64 missing but uri exists (should not happen with new logic)
      return null;
    }

    try {
      console.log('Uploading photo to Neon DB...');
      const db = await getDbClient();
      
      // Insert into harvest_photos
      const { rows } = await db.query(`
        INSERT INTO harvest_photos (photo_data, mime_type)
        VALUES ($1, $2)
        RETURNING id
      `, [photoBase64, 'image/jpeg']);
      
      await db.end();

      if (rows && rows.length > 0) {
        const photoId = rows[0].id;
        console.log('Photo uploaded with ID:', photoId);
        return `db-photo://${photoId}`;
      }
      
      return null;
    } catch (error) {
      console.error('Error uploading photo:', error);
      return null;
    }
  };

  const handleModalClose = () => {
    setShowSuccessModal(false);
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/mandor');
    }
  };

  const handleModalNext = () => {
    setShowSuccessModal(false);
    setFormData(prev => ({
      ...prev,
      blok_ids: [],
      blok_name: '',
      pemanen_id: '',
      nomor_panen: '',
      hasil_panen_bjd: '',
      buah_masak: '',
      buah_mentah: '',
      buah_mengkal: '',
      overripe: '',
      abnormal: '',
      buah_busuk: '',
      tangkai_panjang: '',
      jangkos: '',
      keterangan: '',
    }));
    setPhotoUri(null);
    setPhotoBase64(null);
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }, 100);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <ChevronLeft size={24} color="#fff" />
          </TouchableOpacity>
          <Image
            source={require('@/assets/images/lg-aep-cmyk-300dpi.jpg')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.headerTitle}>{t('input.title')}</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity 
            style={styles.syncHeaderButton} 
            onPress={() => router.push('/sync-manager')}
          >
            {isOffline ? (
              <WifiOff size={20} color="#ffb74d" />
            ) : (
              <Text style={styles.syncHeaderButtonText}>Sync</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView ref={scrollViewRef} style={styles.content} keyboardShouldPersistTaps="handled">
        {isFetchingData && (
          <View style={styles.loadingBanner}>
            <ActivityIndicator size="small" color="#2d5016" />
            <Text style={styles.loadingText}>{t('input.loading.data')}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('input.section.general')}</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              {t('input.label.date')} <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={formData.tanggal}
              onChangeText={(value) => updateField('tanggal', value)}
              placeholder="YYYY-MM-DD"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              {t('input.label.krani')}
            </Text>
            <TextInput
              style={styles.input}
              value={profile?.full_name || ''}
              editable={false}
              placeholder={t('input.label.krani')}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Dropdown
                label={t('input.label.division')}
                placeholder={t('input.placeholder.selectDivision')}
                value={formData.divisi_id}
                items={divisiList.map((divisi) => ({
                  label: divisi.name,
                  value: divisi.id,
                }))}
                onSelect={(value) => {
                  // Clear existing data
                  setGangList([]);
                  setBlokList([]);
                  setPemanenList([]);
                  setTphList([]);
                  setFormData(prev => ({
                    ...prev,
                    divisi_id: value,
                    gang_id: '',
                    blok_ids: [],
                    pemanen_id: '',
                    tph_id: '',
                  }));
                }}
                required
                searchable={divisiList.length > 5}
              />
            </View>

            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Dropdown
                label={t('input.label.plantingYear')}
                placeholder={t('input.placeholder.selectYear')}
                value={formData.tahun_tanam}
                items={Array.from({ length: 2045 - 2008 + 1 }, (_, i) => 2045 - i).map(year => ({
                  label: year.toString(),
                  value: year.toString(),
                }))}
                onSelect={(value) => {
                  updateField('tahun_tanam', value);
                  updateField('blok_name', ''); // Reset blok when tahun tanam changes
                }}
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('input.section.locationAndBlock')}</Text>

          <Dropdown
            label={t('input.label.gang')}
            placeholder={t('input.placeholder.selectGang')}
            value={formData.gang_id}
            items={gangList.map((gang) => ({
              label: gang.name,
              value: gang.id,
            }))}
            onSelect={(value) => updateField('gang_id', value)}
            searchable={gangList.length > 5}
          />

          <EditableDropdown
            label={t('input.label.block')}
            placeholder={t('input.placeholder.selectBlock')}
            value={formData.blok_name}
            items={blokList
              .filter(b => !formData.tahun_tanam || b.tahun_tanam?.toString() === formData.tahun_tanam)
              .map((blok) => ({
                label: blok.name,
                value: blok.name,
              }))}
            onChangeText={(value) => {
              updateField('blok_name', value);
              const selectedBlok = blokList.find(b => b.name === value);
              if (selectedBlok && selectedBlok.tahun_tanam) {
                updateField('tahun_tanam', selectedBlok.tahun_tanam.toString());
              }
            }}
            required
            searchable={blokList.length > 5}
          />

          <EditableDropdown
            label={t('input.label.tphNumber')}
            placeholder={t('input.placeholder.typeOrSelect')}
            value={formData.nomor_panen}
            items={tphList.map((tph) => ({
              label: tph.nomor_tph,
              value: tph.nomor_tph,
            }))}
            onChangeText={(value) => updateField('nomor_panen', value)}
            keyboardType="number-pad"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('input.section.harvestDetail')}</Text>

          <Dropdown
            label={t('input.label.harvesterName')}
            placeholder={t('input.placeholder.selectHarvester')}
            value={formData.pemanen_id}
            items={pemanenList
              .filter(p => !formData.gang_id || p.gang_id === formData.gang_id)
              .map((pemanen) => ({
                label: `${pemanen.operator_code} - ${pemanen.name}`,
                value: pemanen.id,
              }))}
            onSelect={(value) => updateField('pemanen_id', value)}
            required
            searchable
          />

          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              {t('input.label.rotation')} <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={formData.rotasi}
              onChangeText={(value) => updateField('rotasi', value)}
              placeholder={t('input.placeholder.enterRotation')}
              keyboardType="number-pad"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('input.section.yield')}</Text>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('input.label.yieldJjg')}</Text>
              <TextInput
                style={styles.input}
                value={formData.hasil_panen_bjd}
                onChangeText={(value) => updateField('hasil_panen_bjd', value)}
                placeholder="0"
                keyboardType="decimal-pad"
              />
            </View>

            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('input.label.looseFruit')}</Text>
              <TextInput
                style={styles.input}
                value={formData.jumlah_brondolan_kg}
                onChangeText={(value) => updateField('jumlah_brondolan_kg', value)}
                placeholder="0"
                keyboardType="decimal-pad"
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('input.section.fruitCriteria')}</Text>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('input.label.ripe')}</Text>
              <TextInput
                style={styles.input}
                value={formData.buah_masak}
                onChangeText={(value) => updateField('buah_masak', value)}
                placeholder="0"
                keyboardType="number-pad"
              />
            </View>

            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('input.label.unripe')}</Text>
              <TextInput
                style={styles.input}
                value={formData.buah_mentah}
                onChangeText={(value) => updateField('buah_mentah', value)}
                placeholder="0"
                keyboardType="number-pad"
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('input.label.halfRipe')}</Text>
              <TextInput
                style={styles.input}
                value={formData.buah_mengkal}
                onChangeText={(value) => updateField('buah_mengkal', value)}
                placeholder="0"
                keyboardType="number-pad"
              />
            </View>

            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('input.label.overripe')}</Text>
              <TextInput
                style={styles.input}
                value={formData.overripe}
                onChangeText={(value) => updateField('overripe', value)}
                placeholder="0"
                keyboardType="number-pad"
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('input.label.abnormal')}</Text>
              <TextInput
                style={styles.input}
                value={formData.abnormal}
                onChangeText={(value) => updateField('abnormal', value)}
                placeholder="0"
                keyboardType="number-pad"
              />
            </View>

            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('input.label.rotten')}</Text>
              <TextInput
                style={styles.input}
                value={formData.buah_busuk}
                onChangeText={(value) => updateField('buah_busuk', value)}
                placeholder="0"
                keyboardType="number-pad"
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('input.label.longStalk')}</Text>
              <TextInput
                style={styles.input}
                value={formData.tangkai_panjang}
                onChangeText={(value) => updateField('tangkai_panjang', value)}
                placeholder="0"
                keyboardType="number-pad"
              />
            </View>

            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('input.label.emptyBunch')}</Text>
              <TextInput
                style={styles.input}
                value={formData.jangkos}
                onChangeText={(value) => updateField('jangkos', value)}
                placeholder="0"
                keyboardType="number-pad"
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('input.section.harvestPhoto')}</Text>

          {photoUri ? (
            <View>
              <View>
                <Image source={{ uri: photoUri }} style={styles.photoPreview} />
                <View style={styles.previewTimestampContainer}>
                  <Image 
                    source={require('@/assets/images/lg-aep-cmyk-300dpi.jpg')} 
                    style={styles.timestampLogo} 
                    resizeMode="contain" 
                  />
                  <View>
                    <Text style={styles.previewTimestampText}>
                      {divisiList.find(d => d.id === formData.divisi_id)?.estate_name || 'Unknown Estate'}
                    </Text>
                    <Text style={styles.previewTimestampText}>
                      {t('input.label.division')}: {divisiList.find(d => d.id === formData.divisi_id)?.name || '-'}
                    </Text>
                    <Text style={styles.previewTimestampText}>
                      {getFormattedDate(formData.tanggal)}
                    </Text>
                    <Text style={styles.previewTimestampText}>
                      {t('input.label.tph')}: {formData.nomor_panen || '-'}
                    </Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity style={styles.removePhotoButton} onPress={handleRemovePhoto}>
                <X size={20} color="#fff" />
                <Text style={styles.removePhotoText}>{t('input.button.removePhoto')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.photoButtonsContainer}>
              <TouchableOpacity style={styles.cameraButton} onPress={handlePickImage}>
                <ImageIcon size={24} color="#2d5016" />
                <Text style={styles.cameraButtonText}>{t('input.button.uploadPhoto')}</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.photoHint}>{t('input.hint.photo')}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('input.section.notes')}</Text>

          <View style={styles.inputGroup}>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={formData.keterangan}
              onChangeText={(value) => updateField('keterangan', value)}
              placeholder={t('input.placeholder.addNotes')}
              multiline
              numberOfLines={3}
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Save size={20} color="#fff" />
              <Text style={styles.submitButtonText}>{t('input.button.save')}</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>

      {(loading || uploadingPhoto) && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#2d5016" />
            <Text style={styles.loadingText}>
              {uploadingPhoto ? t('input.loading.uploadingPhoto') : t('input.loading.saving')}
            </Text>
          </View>
        </View>
      )}

      <Modal
        visible={showSuccessModal}
        transparent={true}
        animationType="fade"
        onRequestClose={handleModalClose}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalIconContainer}>
              <Check size={32} color="#fff" />
            </View>
            <Text style={styles.modalTitle}>{t('input.success.title')}</Text>
            <Text style={styles.modalMessage}>{successMessage}</Text>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.modalButtonSecondary]} 
                onPress={handleModalClose}
              >
                <Text style={styles.modalButtonSecondaryText}>{t('input.button.backToMenu')}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, styles.modalButtonPrimary]} 
                onPress={handleModalNext}
              >
                <Text style={styles.modalButtonPrimaryText}>{t('input.button.continueInput')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#2d5016',
    paddingTop: 48,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerRight: {
    padding: 8,
  },
  syncHeaderButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  syncHeaderButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  backButton: {
    marginRight: 12,
  },
  logo: {
    width: 40,
    height: 40,
    marginRight: 12,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  content: {
    flex: 1,
  },
  section: {
    backgroundColor: '#fff',
    padding: 16,
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  helperText: {
    fontSize: 12,
    color: '#666',
    backgroundColor: '#fff9c4',
    padding: 8,
    borderRadius: 4,
    marginBottom: 16,
    lineHeight: 18,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 8,
  },
  required: {
    color: '#e53935',
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#333',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  fullWidth: {
    flex: 1,
  },
  submitButton: {
    backgroundColor: '#2d5016',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    margin: 16,
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  photoButtonsContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  flex1: {
    flex: 1,
  },
  cameraButton: {
    backgroundColor: '#f5f5f5',
    borderWidth: 2,
    borderColor: '#2d5016',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  cameraButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2d5016',
  },
  photoPreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
    marginBottom: 12,
  },
  previewTimestampContainer: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    flexDirection: 'row',
    zIndex: 10,
  },
  timestampContainer: {
    position: 'absolute',
    bottom: 120,
    left: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    flexDirection: 'row',
  },
  timestampText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  timestampLogo: {
    width: 40,
    height: 40,
    marginRight: 12,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  previewTimestampText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  removePhotoButton: {
    backgroundColor: '#e53935',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  removePhotoText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  photoHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
  },
  cameraContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 1000,
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  cameraCloseButton: {
    position: 'absolute',
    top: 48,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 12,
    borderRadius: 50,
  },
  cameraActions: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureButton: {
    backgroundColor: '#2d5016',
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  loadingBox: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  loadingBanner: {
    backgroundColor: '#e8f5e9',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    margin: 16,
    marginBottom: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c8e6c9',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2d5016',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonPrimary: {
    backgroundColor: '#2d5016',
  },
  modalButtonSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  modalButtonPrimaryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  modalButtonSecondaryText: {
    color: '#666',
    fontSize: 15,
    fontWeight: '600',
  },
});
