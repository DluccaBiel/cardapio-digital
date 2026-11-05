import type { SVGProps } from 'react'

type IconName =
  | 'grid' | 'calendar' | 'megaphone' | 'file' | 'utensils' | 'puzzle'
  | 'search' | 'chevron-down' | 'chevron-left' | 'chevron-right' | 'panel-left'
  | 'refresh' | 'user' | 'building' | 'x' | 'check' | 'plus' | 'external'

const paths: Record<IconName, JSX.Element> = {
  grid: (<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>),
  calendar: (<><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></>),
  megaphone: (<><path d="M3 11l18-7-4 14-6-3-2 5-2-1 2-4-6-4z" strokeLinejoin="round"/></>),
  file: (<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6M9 9h2"/></>),
  utensils: (<><path d="M7 2v8M4 2v6a3 3 0 0 0 3 3 3 3 0 0 0 3-3V2M7 13v9"/><path d="M15 2a4 4 0 0 0-4 6v3a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V2zM15 13v9"/></>),
  puzzle: (<><path d="M4 7h4a1 1 0 0 0 1-1V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1a1 1 0 0 0 1 1h4a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1v2a1 1 0 0 1-1 1h-3M4 7v10a1 1 0 0 0 1 1h4M4 7a1 1 0 0 1 1-1"/><path d="M16 13h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4v-4a2 2 0 0 0-2-2h0a2 2 0 0 0-2 2v4h4"/></>),
  search: (<><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>),
  'chevron-down': <path d="M6 9l6 6 6-6"/>,
  'chevron-left': <path d="M15 6l-6 6 6 6"/>,
  'chevron-right': <path d="M9 6l6 6-6 6"/>,
  'panel-left': (<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>),
  refresh: (<><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></>),
  user: (<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></>),
  building: (<><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/></>),
  x: (<><path d="M6 6l12 12M18 6L6 18"/></>),
  check: <path d="M4 12l5 5L20 6"/>,
  plus: (<><path d="M12 5v14M5 12h14"/></>),
  external: (<><path d="M14 4h6v6M20 4L10 14"/><path d="M20 14v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6"/></>),
}

export function Icon({ name, className, ...props }: { name: IconName; className?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      width="18"
      height="18"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
