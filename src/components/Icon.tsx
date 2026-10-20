const PATHS = {
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.5-1.9-.3-1 .4-2.1 1.5-2.1H17a4 4 0 0 0 4-4c0-5-4-10-9-10Zm-4 9a1.2 1.2 0 1 1 0-2.4A1.2 1.2 0 0 1 8 12Zm3-4a1.2 1.2 0 1 1 0-2.4A1.2 1.2 0 0 1 11 8Zm5 1a1.2 1.2 0 1 1 0-2.4A1.2 1.2 0 0 1 16 9Z',
  cube: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9',
  stick: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0',
  camera: 'M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  wave: 'M3 12h2M7 8v8M11 4v16M15 8v8M19 10v4M21 12h0',
  archive: 'M4 5h16v4H4zM5 9v10h14V9M10 13h4',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z',
  refresh: 'M20 5v5h-5M4 19v-5h5M5.6 9A7 7 0 0 1 18 7l2 3M18.4 15A7 7 0 0 1 6 17l-2-3',
  min: 'M5 12h14',
  max: 'M6 6h12v12H6z',
  close: 'M6 6l12 12M18 6 6 18',
  play: 'M8 5v14l11-7z',
  stop: 'M7 7h10v10H7z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  check: 'M5 12l5 5 9-10',
  warn: 'M12 4 3 20h18L12 4ZM12 10v5M12 17.5v.5',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
