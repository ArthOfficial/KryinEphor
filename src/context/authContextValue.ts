import { createContext } from 'react';
import type { UserRole } from '../config/roles';

export interface AuthUser {
    id: string;
    email: string;
    fullName?: string;
    schoolId?: string | null;
    schoolName?: string | null;
}

export interface TransitionState {
    show: boolean;
    message: string;
    messages?: string[];
    submessage?: string;
}

export interface AuthContextType {
    user: AuthUser | null;
    role: UserRole | null;
    roles: UserRole[];
    loading: boolean;
    isTransitioning: boolean;
    transition: TransitionState;
    setTransitioning: (val: boolean) => void;
    setTransition: (val: TransitionState) => void;
    switchDashboardRole: (role: UserRole) => void;
    login: (email: string, password: string) => Promise<UserRole>;
    signOut: () => Promise<void>;
    toast: { show: boolean; message: string };
    hideToast: () => void;
}

// Stable context identity across HMR — defined in a non-component module so
// React Fast Refresh never re-creates it. AuthProvider and useAuth both
// import this same object.
export const AuthContext = createContext<AuthContextType | undefined>(undefined);
