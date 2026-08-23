import { AuthShell } from '@/components/auth/AuthShell';

export const metadata = { title: 'Welcome' };

export default function AuthLayout({ children }) {
  return <AuthShell>{children}</AuthShell>;
}
