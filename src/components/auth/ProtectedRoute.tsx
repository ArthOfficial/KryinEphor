import React from 'react';
import { useAuth } from '../../context/AuthContext';
import NotFound from '../../pages/NotFound';

interface ProtectedRouteProps {
    children: React.ReactNode;
    allowedRoles?: string[];
}

/**
 * Route-level auth guard.
 * AuthProvider resolves the Supabase session, profile, and roles once before
 * any protected route renders. Row Level Security remains the data boundary.
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
    const { user, roles, loading } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#FAF9F6]" role="status" aria-label="Loading workspace">
                <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
        );
    }

    if (!user) return <NotFound variant="unauthorized" />;

    if (allowedRoles && !roles.some(r => allowedRoles.includes(r))) {
        return <NotFound variant="unauthorized" />;
    }

    return <>{children}</>;
};

export default ProtectedRoute;
