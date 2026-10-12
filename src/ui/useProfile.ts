import { useSyncExternalStore } from 'react';
import { getProfile, subscribe } from '../game/profile';

export function useProfile() {
  return useSyncExternalStore(subscribe, getProfile);
}
