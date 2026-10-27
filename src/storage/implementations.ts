import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LocalImageStorage, SessionStorage, StorageAdapter } from './storage-adapter';
import { uuid } from '@/utils/id';
import { File, Directory, Paths } from 'expo-file-system';

export class AsyncStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  }
}

export class LocalSessionStorage implements SessionStorage {
  constructor(private adapter: StorageAdapter) {}

  async getToken(): Promise<string | null> {
    return this.adapter.get('vanta.session.token');
  }

  async setToken(token: string): Promise<void> {
    await this.adapter.set('vanta.session.token', token);
  }

  async clearToken(): Promise<void> {
    await this.adapter.remove('vanta.session.token');
  }
}

export class LocalDeviceImageStorage implements LocalImageStorage {
  async saveImageFromUri(uri: string, folder: string): Promise<string> {
    try {
      if (uri.startsWith('p:')) return uri;
      const file = new File(uri);
      if (!file.exists) {
        throw new Error('Source file not found');
      }
      const dir = new Directory(Paths.document, 'vanta-images', folder);
      dir.create({ idempotent: true, intermediates: true });
      const extension = file.extension || '.jpg';
      const target = new File(dir, `${uuid()}${extension}`);
      file.copy(target);
      return target.uri;
    } catch (error) {
      console.warn('Image copy failed, storing original uri', error);
      return uri;
    }
  }
}