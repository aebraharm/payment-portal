import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function makeIcon(path: React.ReactNode) {
  return function Icon({ className = 'h-5 w-5', ...props }: IconProps) {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {path}
      </svg>
    );
  };
}

export const IconHome = makeIcon(<path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5M9.5 21v-6h5v6" />);
export const IconDoc = makeIcon(<path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" />);
export const IconWallet = makeIcon(<path d="M3 7h18v13H3zM3 7l2-3h14l2 3M16 13.5h.01" />);
export const IconCard = makeIcon(<path d="M3 6h18v12H3zM3 10h18M7 15h4" />);
export const IconBank = makeIcon(<path d="M3 9l9-5 9 5M4 9v10M9 9v10M15 9v10M20 9v10M2 21h20M3 19h18" />);
export const IconGlobe = makeIcon(<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z" />);
export const IconUsers = makeIcon(<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 21v-2a4 4 0 0 0-3-3.87M15.5 4.13a3.5 3.5 0 0 1 0 6.75" />);
export const IconSettings = makeIcon(<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />);
export const IconShield = makeIcon(<path d="M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6zM9 12l2 2 4-4" />);
export const IconBell = makeIcon(<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10.5 20a1.8 1.8 0 0 0 3 0" />);
export const IconSearch = makeIcon(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>);
export const IconCopy = makeIcon(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>);
export const IconCheck = makeIcon(<path d="M4 12.5l5 5L20 6.5" />);
export const IconX = makeIcon(<path d="M6 6l12 12M18 6L6 18" />);
export const IconArrowLeft = makeIcon(<path d="M19 12H5M11 6l-6 6 6 6" />);
export const IconArrowRight = makeIcon(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IconUpload = makeIcon(<path d="M12 16V4M7 9l5-5 5 5M4 20h16" />);
export const IconDownload = makeIcon(<path d="M12 4v12M7 11l5 5 5-5M4 20h16" />);
export const IconEye = makeIcon(<><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.8" /></>);
export const IconLock = makeIcon(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const IconLogout = makeIcon(<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />);
export const IconMenu = makeIcon(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconChevronDown = makeIcon(<path d="M6 9l6 6 6-6" />);
export const IconChevronRight = makeIcon(<path d="M9 6l6 6-6 6" />);
export const IconAlert = makeIcon(<path d="M12 3l10 18H2zM12 10v4M12 17.5h.01" />);
export const IconInfo = makeIcon(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>);
export const IconRefresh = makeIcon(<path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6" />);
export const IconSend = makeIcon(<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />);
export const IconClock = makeIcon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IconFile = makeIcon(<path d="M7 3h7l4 4v14H7zM14 3v4h4" />);
export const IconMail = makeIcon(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>);
export const IconPhone = makeIcon(<path d="M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />);
export const IconPin = makeIcon(<><path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>);
export const IconPlus = makeIcon(<path d="M12 5v14M5 12h14" />);
export const IconPencil = makeIcon(<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" />);
export const IconTrash = makeIcon(<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />);
export const IconFilter = makeIcon(<path d="M4 5h16l-6 7v6l-4 2v-8z" />);
export const IconList = makeIcon(<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />);
export const IconChart = makeIcon(<path d="M4 20V10M10 20V4M16 20v-7M2 20h20" />);
export const IconKey = makeIcon(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M14 9l2 2" /></>);
export const IconBuilding = makeIcon(<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h3a1 1 0 0 1 1 1v11M2 21h20M8 7h2M8 11h2M8 15h2M12 7h.01M12 11h.01M12 15h.01" />);
export const IconSupport = makeIcon(<><path d="M4 13a8 8 0 1 1 16 0" /><path d="M4 13v4a2 2 0 0 0 2 2h1v-6H5a1 1 0 0 0-1 1zM20 13v4a2 2 0 0 1-2 2h-1v-6h2a1 1 0 0 1 1 1z" /></>);
