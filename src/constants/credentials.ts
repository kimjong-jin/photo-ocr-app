import { UserRole } from '../types';

interface UserCredential {
  password?: string;
  role: UserRole;
}

export const USER_CREDENTIALS: Record<string, UserCredential> = {
  "김종진": { password: "1212", role: "user" },
  "김성대": { password: "3621", role: "user" },
  "정진욱": { password: "2543", role: "user" },
  "권민경": { password: "7315", role: "user" },
  "정슬기": { password: "6357", role: "user" },
  "김수철": { password: "0821", role: "user" },
  "강준": { password: "6969", role: "user" },
  "게스트": { password: "ktl", role: "guest" }
};