// The Help screen and the guided tour, as data (Video Tools keeps its (i) box and tour the same way). Plain words only.
export interface HelpSection { id: string; title: string; body: string[] }

export const HELP_SEEN_KEY = 'shelf:info-seen:v1';

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'what',
    title: 'What the shelf is',
    body: [
      'Vault Shelf remembers what you copy on this PC, so you can look back at it and send a copy to Vault with one click.',
      'It sits in the tray (near the clock) and costs almost nothing while it is closed. Press the shortcut to open it; press it again, or Esc, to close it.',
    ],
  },
  {
    id: 'use',
    title: 'Using it',
    body: [
      'Pick a copy on the left to see it on the right. Arrow keys move along the row and 1 to 9 jump to a copy.',
      'Enter puts the chosen copy back on the clipboard and closes the shelf, ready to paste. Delete takes it off the shelf.',
      'The tabs along the top show only text, pictures, links or tables.',
    ],
  },
  {
    id: 'send',
    title: 'Sending to Vault',
    body: [
      'Save as Note puts the copy into Vault Notes. Attach to CRM sends it to the CRM, where it waits under Unfiled from Shelf until you attach it to a client.',
      'Ingest to Finance sends a receipt or invoice to Invoice Review. Nothing is posted: you approve it in Vault.',
      'Ask Redaction checks the text for private details and shows them highlighted. Nothing is stored and nothing is changed.',
      'A greyed button means your key cannot do that yet. Hover over it to see why.',
    ],
  },
  {
    id: 'connect',
    title: 'Connecting to Vault',
    body: [
      'Open Settings. In Vault, go to Settings, then Vault Shelf, and make a key. Paste your Vault address and the key into the shelf and press Save and check.',
      'The key is checked with Vault first. It is kept in Windows Credential Manager, never in a file, and it is never shown again.',
      'If you lose it, make a new one in Vault. You can also switch a key off there at any time.',
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy',
    body: [
      'Anything that looks like a password, key or token is hidden before it is saved. A hidden copy can be read here but is never sent to Vault.',
      'Copies from password managers, and from programs you list in Settings, are never kept.',
      'The history is encrypted on this PC and only holds the number of copies you choose. Nothing leaves this PC until you press a send button.',
    ],
  },
  {
    id: 'trouble',
    title: 'If something is wrong',
    body: [
      'The shortcut does nothing: another program may already use it. Click the tray icon instead, or choose another shortcut in Settings.',
      'The buttons are grey: add your key in Settings. If it says the key was not accepted, make a new one in Vault.',
      'Nothing is appearing: check the tray menu has not been set to Pause monitoring.',
    ],
  },
];

export interface TourStep { target: string; title: string; text: string }

/** The tour points at elements marked data-tour="..." on the shelf page. */
export const TOUR_STEPS: TourStep[] = [
  { target: 'filters', title: 'Filter what you copied', text: 'Show everything, or only text, pictures, links or tables.' },
  { target: 'cards', title: 'Your recent copies', text: 'Newest first. Click one, or use the arrow keys and the numbers 1 to 9.' },
  { target: 'preview', title: 'See it properly', text: 'Code is coloured, tables become grids, pictures are shown, colours get a swatch.' },
  { target: 'actions', title: 'Send it to Vault', text: 'One click sends the copy to Notes, CRM or Finance, or checks it for private details. Hover a button for what it does.' },
  { target: 'settings', title: 'Make it yours', text: 'Connect to Vault, change the shortcut and the look, and choose what is never kept.' },
  { target: 'help', title: 'Help is always here', text: 'This button explains everything in plain words, and the compass inside it takes this tour again.' },
];
