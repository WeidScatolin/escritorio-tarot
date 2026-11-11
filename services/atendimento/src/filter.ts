import type { Conversation } from './store.js';
import type { InboundMessage } from './types.js';

export type Decision =
  | { engage: true; reason: 'ad_referral' | 'trigger_phrase' | 'existing_lead' | 'all_chats' }
  | {
      engage: false;
      reason: 'from_me' | 'group' | 'blocklisted' | 'human_takeover' | 'not_a_lead';
    };

export type FilterContext = {
  conversation: Conversation | null;
  triggerPhrases: string[];
  blocklist: Set<string>;
  /** Número só do negócio: atende qualquer conversa individual nova (grupos, bloqueados e dono assumindo seguem de fora). */
  engageAll?: boolean;
};

const STATUS_BROADCAST_JID = 'status@broadcast';
const GROUP_JID_SUFFIX = '@g.us';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function matchesTrigger(text: string | null, phrases: string[]): boolean {
  if (text === null) return false;
  const haystack = normalize(text);
  return phrases.some((phrase) => {
    const needle = normalize(phrase);
    return needle.length > 0 && haystack.includes(needle);
  });
}

function isGroupLike(msg: InboundMessage): boolean {
  return msg.isGroup || msg.jid === STATUS_BROADCAST_JID || msg.jid.endsWith(GROUP_JID_SUFFIX);
}

/** Pure: decides whether the assistant should answer this inbound message. When in doubt, do not engage. */
export function decide(msg: InboundMessage, ctx: FilterContext): Decision {
  if (msg.fromMe) return { engage: false, reason: 'from_me' };
  if (isGroupLike(msg)) return { engage: false, reason: 'group' };
  if (ctx.blocklist.has(msg.jid)) return { engage: false, reason: 'blocklisted' };
  if (ctx.conversation?.mode === 'human') return { engage: false, reason: 'human_takeover' };
  if (msg.adReferral !== null) return { engage: true, reason: 'ad_referral' };
  if (matchesTrigger(msg.text, ctx.triggerPhrases)) return { engage: true, reason: 'trigger_phrase' };
  if (ctx.conversation !== null && ctx.conversation.engagedAt !== null) {
    return { engage: true, reason: 'existing_lead' };
  }
  if (ctx.engageAll === true) return { engage: true, reason: 'all_chats' };
  return { engage: false, reason: 'not_a_lead' };
}
