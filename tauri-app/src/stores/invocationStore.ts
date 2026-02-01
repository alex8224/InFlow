import { create } from 'zustand';
import { Invocation } from '../core/types';

interface InvocationStore {
  currentInvocation: Invocation | null;
  setCurrentInvocation: (invocation: Invocation | null) => void;
  activeService: 'google' | 'ai';
  setActiveService: (service: 'google' | 'ai') => void;
}

export const useInvocationStore = create<InvocationStore>((set) => ({
  currentInvocation: null,
  setCurrentInvocation: (invocation) => set({ currentInvocation: invocation }),
  activeService: 'google',
  setActiveService: (service) => set({ activeService: service }),
}));
