import { env } from '../env.ts';

/**
 * Contract shared by the canvas-ux agents (lead-owned stub; LINKED serves the page).
 * The one-tap "Open in iMessage" page for any "text Cubbie this" instruction: GET /go/cubbie?text=...
 * Use it as a Telegram URL button. Works in Telegram's in-app browser (the page has Copy as a fallback).
 */
export const cubbieOpenUrl = (text: string) => `${env.publicUrl}/go/cubbie?text=${encodeURIComponent(text)}`;

/** Button label for every "text Cubbie" instruction. */
export const OPEN_IN_IMESSAGE = 'Open in iMessage';
