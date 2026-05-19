import { useCallback, useEffect, useState } from 'react';
import Ico from '../components/Icons';
import { PageHeader } from '../components/collection';
import {
  createWiring,
  deleteWiring,
  fetchDiscordConfig,
  fetchDispatchChannels,
  fetchDispatchStatus,
  fetchMessagingGroups,
  fetchSlackConfig,
  fetchTelegramConfig,
  fetchWhatsAppConfig,
  fetchWirings,
  getApiOrigin,
  saveDiscordConfig,
  saveSlackConfig,
  saveTelegramConfig,
  saveWhatsAppConfig,
  startDiscordInstall,
  startSlackOAuth,
} from '../api';

const CHANNEL_LIBRARY = {
  slack: {
    id: 'slack',
    name: 'Slack',
    description: 'Receive messages from a Slack workspace and reply via the bot user. App mentions and DMs are routed; threads stay sticky.',
    style: 'slack',
    connectable: true,
  },
  telegram: {
    id: 'telegram',
    name: 'Telegram',
    description: 'Receive messages via a Telegram bot. Uses long-polling by default — no public URL needed. Group chats require @mention to trigger.',
    style: 'telegram',
    connectable: false,  // No connect-button flow — saving the bot token is the install.
  },
  discord: {
    id: 'discord',
    name: 'Discord',
    description: 'Receive messages from Discord guilds via the Gateway WebSocket — no public URL needed. Slash commands (/anton) route through the Interactions endpoint.',
    style: 'discord',
    connectable: true,
  },
  whatsapp: {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Receive messages from your WhatsApp Cloud business number. Free-form replies are allowed inside the 24-hour customer-care window after each user message.',
    style: 'whatsapp',
    connectable: false,
    comingSoon: true,
    chip: 'Coming soon',
  },
};

const SESSION_MODES = [
  { value: 'agent-shared', label: 'Agent shared (one session per agent)' },
  { value: 'per-messaging-group', label: 'Per channel (default)' },
  { value: 'per-thread', label: 'Per thread (Slack threads only)' },
];

const TRIGGER_RULES = [
  { value: 'always', label: 'Every message' },
  { value: 'mention-only', label: 'Mentions only' },
  { value: 'regex', label: 'Custom regex' },
];

function StatusBadge({ active, registered }) {
  if (active) return <span className="dispatch-status dispatch-status-active">Connected</span>;
  if (registered) return <span className="dispatch-status dispatch-status-pending">Configure credentials</span>;
  return <span className="dispatch-status dispatch-status-idle">Not connected</span>;
}

function SlackConfigPanel({ initialStatus, onSaved }) {
  const [status, setStatus] = useState(initialStatus);
  const [editing, setEditing] = useState(!initialStatus.install_ready);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [appToken, setAppToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => { setStatus(initialStatus); }, [initialStatus]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const next = await saveSlackConfig({
        clientId:      clientId      || undefined,
        clientSecret:  clientSecret  || undefined,
        signingSecret: signingSecret || undefined,
        appToken:      appToken      || undefined,
      });
      setStatus(next);
      setClientId(''); setClientSecret(''); setSigningSecret(''); setAppToken('');
      setSavedAt(Date.now());
      setEditing(!next.install_ready);
      onSaved?.(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const Indicator = ({ set, label }) => (
    <span className={`dispatch-config-flag ${set ? 'dispatch-config-flag-set' : 'dispatch-config-flag-unset'}`}>
      {set ? Ico.check(12) : null}
      <span>{label} · {set ? 'Set' : 'Not set'}</span>
    </span>
  );

  // Mode indicator — Socket Mode is preferred for local dev (no public URL
  // needed); webhook mode requires an externally reachable callback URL.
  const ModeBadge = () => {
    if (status.socket_mode_ready) {
      return (
        <span className="dispatch-config-flag dispatch-config-flag-set" title="Slack pushes events down a WebSocket — no public URL needed.">
          {Ico.check(12)}
          <span>Mode · Socket</span>
        </span>
      );
    }
    return (
      <span className="dispatch-config-flag dispatch-config-flag-unset" title="Webhook mode — Slack POSTs to /v1/dispatch/slack/events. Requires a public Request URL.">
        <span>Mode · Webhook</span>
      </span>
    );
  };

  if (!editing) {
    return (
      <div className="dispatch-config-summary">
        <div className="dispatch-config-flags">
          <ModeBadge />
          <Indicator set={status.client_id_set}      label="Client ID" />
          <Indicator set={status.client_secret_set}  label="Client Secret" />
          <Indicator set={status.signing_secret_set} label="Signing Secret" />
          <Indicator set={status.app_token_set}      label="App Token (Socket)" />
        </div>
        <button type="button" className="dispatch-btn dispatch-btn-ghost dispatch-btn-link" onClick={() => setEditing(true)}>
          Edit credentials
        </button>
      </div>
    );
  }

  return (
    <form className="dispatch-config-form" onSubmit={submit}>
      <input
        className="dispatch-input"
        type="text"
        placeholder={status.client_id_set ? 'Client ID (set — leave blank to keep)' : 'Slack Client ID'}
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="password"
        placeholder={status.client_secret_set ? 'Client Secret (set — leave blank to keep)' : 'Slack Client Secret'}
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="password"
        placeholder={status.signing_secret_set ? 'Signing Secret (set — leave blank to keep)' : 'Slack Signing Secret'}
        value={signingSecret}
        onChange={(e) => setSigningSecret(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="password"
        placeholder={status.app_token_set ? 'App-Level Token / xapp-… (set — leave blank to keep)' : 'Slack App-Level Token (xapp-…) — enables Socket Mode'}
        value={appToken}
        onChange={(e) => setAppToken(e.target.value)}
        autoComplete="off"
      />
      <div className="dispatch-config-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save credentials'}
        </button>
        {status.install_ready ? (
          <button type="button" className="dispatch-btn dispatch-btn-ghost dispatch-btn-link" onClick={() => setEditing(false)}>
            Cancel
          </button>
        ) : null}
      </div>
      {error ? <p className="dispatch-error">{error}</p> : null}
      {savedAt ? (
        <p className="dispatch-config-hint">
          Saved to ~/.anton/.env. Restart cowork-gateway so the bridge picks
          up the new values
          {status.socket_mode_ready
            ? ' — Socket Mode will reconnect automatically.'
            : '.'}
        </p>
      ) : null}
    </form>
  );
}

function TelegramConfigPanel({ initialStatus, onSaved }) {
  const [status, setStatus] = useState(initialStatus);
  const [editing, setEditing] = useState(!initialStatus.install_ready);
  const [botToken, setBotToken] = useState('');
  const [botUsername, setBotUsername] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => { setStatus(initialStatus); }, [initialStatus]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const next = await saveTelegramConfig({
        botToken:    botToken    || undefined,
        botUsername: botUsername || undefined,
        webhookUrl:  webhookUrl  || undefined,
      });
      setStatus(next);
      setBotToken(''); setBotUsername(''); setWebhookUrl('');
      setSavedAt(Date.now());
      setEditing(!next.install_ready);
      onSaved?.(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const Indicator = ({ set, label }) => (
    <span className={`dispatch-config-flag ${set ? 'dispatch-config-flag-set' : 'dispatch-config-flag-unset'}`}>
      {set ? Ico.check(12) : null}
      <span>{label} · {set ? 'Set' : 'Not set'}</span>
    </span>
  );

  // Long-poll is the default and works without any public URL. Webhook mode
  // kicks in only if the operator pasted a TELEGRAM_WEBHOOK_URL — useful for
  // hosted deployments where polling would waste a worker.
  const ModeBadge = () => {
    if (status.mode === 'webhook') {
      return (
        <span className="dispatch-config-flag dispatch-config-flag-set" title="Telegram POSTs to /v1/dispatch/telegram/webhook. Requires a public URL.">
          {Ico.check(12)}
          <span>Mode · Webhook</span>
        </span>
      );
    }
    return (
      <span className="dispatch-config-flag dispatch-config-flag-set" title="The bot calls getUpdates with a 30s long-poll — no public URL needed.">
        {Ico.check(12)}
        <span>Mode · Long-poll</span>
      </span>
    );
  };

  if (!editing) {
    return (
      <div className="dispatch-config-summary">
        <div className="dispatch-config-flags">
          <ModeBadge />
          <Indicator set={status.bot_token_set}    label="Bot Token" />
          <Indicator set={status.bot_username_set} label="Bot Username" />
          <Indicator set={status.webhook_url_set}  label="Webhook URL" />
        </div>
        <button type="button" className="dispatch-btn dispatch-btn-ghost dispatch-btn-link" onClick={() => setEditing(true)}>
          Edit credentials
        </button>
      </div>
    );
  }

  return (
    <form className="dispatch-config-form" onSubmit={submit}>
      <input
        className="dispatch-input"
        type="password"
        placeholder={status.bot_token_set ? 'Bot Token (set — leave blank to keep)' : 'Bot Token (12345:ABC-…)'}
        value={botToken}
        onChange={(e) => setBotToken(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="text"
        placeholder={status.bot_username_set ? 'Bot Username (set — leave blank to keep)' : 'Bot @username (auto-detected on save — fill to override)'}
        value={botUsername}
        onChange={(e) => setBotUsername(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="text"
        placeholder={status.webhook_url_set ? 'Webhook URL (set — leave blank to keep)' : 'Webhook URL (optional — leave blank for long-poll)'}
        value={webhookUrl}
        onChange={(e) => setWebhookUrl(e.target.value)}
        autoComplete="off"
      />
      <p className="dispatch-config-hint">
        Get a token from <strong>@BotFather</strong> on Telegram (<code>/newbot</code>). Username is fetched automatically via <code>getMe</code> when you save.
      </p>
      <div className="dispatch-config-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save credentials'}
        </button>
        {status.install_ready ? (
          <button type="button" className="dispatch-btn dispatch-btn-ghost dispatch-btn-link" onClick={() => setEditing(false)}>
            Cancel
          </button>
        ) : null}
      </div>
      {error ? <p className="dispatch-error">{error}</p> : null}
      {savedAt ? (
        <p className="dispatch-config-hint">
          Saved to ~/.anton/.env. Restart cowork-gateway so the bridge picks up
          the new values — long-poll will start automatically once a token is
          present.
        </p>
      ) : null}
    </form>
  );
}

function DiscordConfigPanel({ initialStatus, onSaved }) {
  const [status, setStatus] = useState(initialStatus);
  const [editing, setEditing] = useState(!initialStatus.gateway_ready);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [botToken, setBotToken] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setStatus(initialStatus); }, [initialStatus]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const next = await saveDiscordConfig({
        clientId:     clientId     || undefined,
        clientSecret: clientSecret || undefined,
        botToken:     botToken     || undefined,
        publicKey:    publicKey    || undefined,
      });
      setStatus(next);
      setClientId(''); setClientSecret(''); setBotToken(''); setPublicKey('');
      setEditing(!next.gateway_ready);
      onSaved?.(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const Indicator = ({ set, label }) => (
    <span className={`dispatch-config-flag ${set ? 'dispatch-config-flag-set' : 'dispatch-config-flag-unset'}`}>
      {set ? Ico.check(12) : null}
      <span>{label} · {set ? 'Set' : 'Not set'}</span>
    </span>
  );

  // Gateway is the chat-ingress path; Interactions is slash-command-only and
  // additionally requires the application public key for Ed25519 verify.
  const ModeBadge = () => (
    <span
      className={`dispatch-config-flag ${status.gateway_ready ? 'dispatch-config-flag-set' : 'dispatch-config-flag-unset'}`}
      title="Discord pushes events down a Gateway WebSocket — no public URL needed for chat."
    >
      {status.gateway_ready ? Ico.check(12) : null}
      <span>Mode · Gateway</span>
    </span>
  );

  if (!editing) {
    return (
      <div className="dispatch-config-summary">
        <div className="dispatch-config-flags">
          <ModeBadge />
          <Indicator set={status.bot_token_set}     label="Bot Token" />
          <Indicator set={status.public_key_set}    label="Public Key" />
          <Indicator set={status.client_id_set}     label="Client ID" />
          <Indicator set={status.client_secret_set} label="Client Secret" />
        </div>
        <button type="button" className="dispatch-btn dispatch-btn-ghost dispatch-btn-link" onClick={() => setEditing(true)}>
          Edit credentials
        </button>
      </div>
    );
  }

  return (
    <form className="dispatch-config-form" onSubmit={submit}>
      <input
        className="dispatch-input"
        type="password"
        placeholder={status.bot_token_set ? 'Bot Token (set — leave blank to keep)' : 'Discord Bot Token'}
        value={botToken}
        onChange={(e) => setBotToken(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="text"
        placeholder={status.public_key_set ? 'Public Key (set — leave blank to keep)' : 'Application Public Key (hex) — used for /interactions'}
        value={publicKey}
        onChange={(e) => setPublicKey(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="text"
        placeholder={status.client_id_set ? 'Client ID (set — leave blank to keep)' : 'Application Client ID — used by Add to server'}
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="password"
        placeholder={status.client_secret_set ? 'Client Secret (set — leave blank to keep)' : 'Application Client Secret'}
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
        autoComplete="off"
      />
      <div className="dispatch-config-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save credentials'}
        </button>
        {status.gateway_ready ? (
          <button type="button" className="dispatch-btn dispatch-btn-ghost dispatch-btn-link" onClick={() => setEditing(false)}>
            Cancel
          </button>
        ) : null}
      </div>
      {error ? <p className="dispatch-error">{error}</p> : null}
    </form>
  );
}

function WhatsAppConfigPanel({ initialStatus, onSaved }) {
  const [status, setStatus] = useState(initialStatus);
  const [editing, setEditing] = useState(!initialStatus.install_ready);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setStatus(initialStatus); }, [initialStatus]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const next = await saveWhatsAppConfig({
        phoneNumberId:     phoneNumberId     || undefined,
        accessToken:       accessToken       || undefined,
        verifyToken:       verifyToken       || undefined,
        appSecret:         appSecret         || undefined,
        businessAccountId: businessAccountId || undefined,
      });
      setStatus(next);
      setPhoneNumberId(''); setAccessToken(''); setVerifyToken('');
      setAppSecret(''); setBusinessAccountId('');
      setEditing(!next.install_ready);
      onSaved?.(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const Indicator = ({ set, label }) => (
    <span className={`dispatch-config-flag ${set ? 'dispatch-config-flag-set' : 'dispatch-config-flag-unset'}`}>
      {set ? Ico.check(12) : null}
      <span>{label} · {set ? 'Set' : 'Not set'}</span>
    </span>
  );

  // WhatsApp Cloud is always webhook-driven — Meta POSTs to our /webhook URL.
  // The "mode" badge is informational only; there's no long-poll alternative.
  const ModeBadge = () => (
    <span
      className={`dispatch-config-flag ${status.install_ready ? 'dispatch-config-flag-set' : 'dispatch-config-flag-unset'}`}
      title="Meta POSTs to /v1/dispatch/whatsapp/webhook. Requires a public HTTPS URL configured in the Meta app."
    >
      {status.install_ready ? Ico.check(12) : null}
      <span>Mode · Webhook</span>
    </span>
  );

  if (!editing) {
    return (
      <div className="dispatch-config-summary">
        <div className="dispatch-config-flags">
          <ModeBadge />
          <Indicator set={status.phone_number_id_set}     label="Phone Number ID" />
          <Indicator set={status.access_token_set}        label="Access Token" />
          <Indicator set={status.verify_token_set}        label="Verify Token" />
          <Indicator set={status.app_secret_set}          label="App Secret" />
          <Indicator set={status.business_account_id_set} label="WABA ID" />
        </div>
        <button type="button" className="dispatch-btn dispatch-btn-ghost dispatch-btn-link" onClick={() => setEditing(true)}>
          Edit credentials
        </button>
      </div>
    );
  }

  return (
    <form className="dispatch-config-form" onSubmit={submit}>
      <input
        className="dispatch-input"
        type="text"
        placeholder={status.phone_number_id_set ? 'Phone Number ID (set — leave blank to keep)' : 'Phone Number ID (sender)'}
        value={phoneNumberId}
        onChange={(e) => setPhoneNumberId(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="password"
        placeholder={status.access_token_set ? 'Access Token (set — leave blank to keep)' : 'Permanent System-User Access Token'}
        value={accessToken}
        onChange={(e) => setAccessToken(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="password"
        placeholder={status.verify_token_set ? 'Verify Token (set — leave blank to keep)' : 'Verify Token (you choose; pasted into Meta when subscribing the webhook)'}
        value={verifyToken}
        onChange={(e) => setVerifyToken(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="password"
        placeholder={status.app_secret_set ? 'App Secret (set — leave blank to keep)' : 'App Secret (used to verify X-Hub-Signature-256)'}
        value={appSecret}
        onChange={(e) => setAppSecret(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="text"
        placeholder={status.business_account_id_set ? 'WABA ID (set — leave blank to keep)' : 'WhatsApp Business Account ID (optional)'}
        value={businessAccountId}
        onChange={(e) => setBusinessAccountId(e.target.value)}
        autoComplete="off"
      />
      <div className="dispatch-config-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save credentials'}
        </button>
        {status.install_ready ? (
          <button type="button" className="dispatch-btn dispatch-btn-ghost dispatch-btn-link" onClick={() => setEditing(false)}>
            Cancel
          </button>
        ) : null}
      </div>
      {error ? <p className="dispatch-error">{error}</p> : null}
    </form>
  );
}

function ChannelCard({
  entry, onConnect, busy, error,
  slackStatus, onSlackStatus,
  telegramStatus, onTelegramStatus,
  discordStatus, onDiscordStatus,
  whatsappStatus, onWhatsAppStatus,
}) {
  const info = CHANNEL_LIBRARY[entry.type] || { id: entry.type, name: entry.type, description: '' };
  const isSlack = entry.type === 'slack';
  const isTelegram = entry.type === 'telegram';
  const isDiscord = entry.type === 'discord';
  const isWhatsApp = entry.type === 'whatsapp';
  const slackReady = !isSlack || (slackStatus?.install_ready ?? false);
  const discordReady = !isDiscord || (discordStatus?.install_ready ?? false);
  const connectDisabled =
    busy || (isSlack && !slackReady) || (isDiscord && !discordReady);
  // Channels flagged `comingSoon` are visually disabled — the config panel
  // and connect flow are suppressed and the card carries a "Coming soon" chip.
  const comingSoon = Boolean(info.comingSoon);
  return (
    <div
      className={[
        'dispatch-channel-card',
        `dispatch-channel-${info.style || entry.type}`,
        comingSoon ? 'dispatch-channel-coming-soon' : '',
      ].filter(Boolean).join(' ')}
      aria-disabled={comingSoon || undefined}
    >
      <header className="dispatch-channel-head">
        <div>
          <h3>{info.name}</h3>
          {comingSoon ? null : (
            <StatusBadge active={entry.active} registered={entry.registered} />
          )}
        </div>
        {info.chip ? <span className="dispatch-channel-chip">{info.chip}</span> : null}
      </header>
      <p className="dispatch-channel-desc">{info.description}</p>

      {comingSoon ? null : (
        <>
          {isSlack && slackStatus ? (
            <SlackConfigPanel initialStatus={slackStatus} onSaved={onSlackStatus} />
          ) : null}

          {isTelegram && telegramStatus ? (
            <TelegramConfigPanel initialStatus={telegramStatus} onSaved={onTelegramStatus} />
          ) : null}

          {isDiscord && discordStatus ? (
            <DiscordConfigPanel initialStatus={discordStatus} onSaved={onDiscordStatus} />
          ) : null}

          {isWhatsApp && whatsappStatus ? (
            <WhatsAppConfigPanel initialStatus={whatsappStatus} onSaved={onWhatsAppStatus} />
          ) : null}
        </>
      )}

      {!comingSoon && info.connectable && !entry.active ? (
        <button
          type="button"
          className="btn-primary"
          onClick={() => onConnect(entry.type)}
          disabled={connectDisabled}
          title={
            isSlack && !slackReady ? 'Save the Slack credentials first'
            : isDiscord && !discordReady ? 'Save the Discord client ID first'
            : undefined
          }
        >
          {Ico.plus(14)}
          <span>{busy ? 'Opening sign-in…' : `Connect ${info.name}`}</span>
        </button>
      ) : null}
      {error ? <p className="dispatch-error">{error}</p> : null}
    </div>
  );
}

/** One wiring row with inline-editable session mode and trigger rule.
 *  Saving re-POSTs to /dispatch/wirings — the same (messaging group, agent
 *  group) key, so the server's INSERT OR REPLACE updates the existing row in
 *  place. The Save button shows only while the row differs from what's
 *  persisted. */
function WiringRow({ wiring, channelName, onSaved, onRemove }) {
  const [sessionMode, setSessionMode] = useState(wiring.session_mode);
  const [triggerRule, setTriggerRule] = useState(wiring.trigger_rule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const dirty =
    sessionMode !== wiring.session_mode ||
    triggerRule !== wiring.trigger_rule;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await createWiring({
        messaging_group_id: wiring.messaging_group_id,
        session_mode: sessionMode,
        trigger_rule: triggerRule,
      });
      onSaved(updated.wiring);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="dispatch-list-row">
      <span className="dispatch-list-name">{channelName} → Anton</span>
      <div className="dispatch-wiring-edit">
        <select
          className="dispatch-input dispatch-input-sm"
          value={sessionMode}
          onChange={(e) => setSessionMode(e.target.value)}
          title="Session mode"
        >
          {SESSION_MODES.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
        </select>
        <select
          className="dispatch-input dispatch-input-sm"
          value={triggerRule}
          onChange={(e) => setTriggerRule(e.target.value)}
          title="Trigger rule"
        >
          {TRIGGER_RULES.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
        </select>
        {error ? <span className="dispatch-error">{error}</span> : null}
      </div>
      {dirty ? (
        <button type="button" className="dispatch-btn" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      ) : null}
      <button type="button" className="dispatch-btn dispatch-btn-icon" onClick={onRemove}>
        {Ico.trash(14)}
      </button>
    </li>
  );
}

export default function DispatchView() {
  const [status, setStatus] = useState(null);
  const [channels, setChannels] = useState([]);
  const [wirings, setWirings] = useState([]);
  const [messagingGroups, setMessagingGroups] = useState([]);
  const [slackStatus, setSlackStatus] = useState(null);
  const [telegramStatus, setTelegramStatus] = useState(null);
  const [discordStatus, setDiscordStatus] = useState(null);
  const [whatsappStatus, setWhatsAppStatus] = useState(null);
  const [connectError, setConnectError] = useState({});
  const [connectBusy, setConnectBusy] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, c, w, mg, sc, tc, dc, wc] = await Promise.all([
        fetchDispatchStatus(),
        fetchDispatchChannels(),
        fetchWirings(),
        fetchMessagingGroups(),
        fetchSlackConfig(),
        fetchTelegramConfig(),
        fetchDiscordConfig(),
        fetchWhatsAppConfig(),
      ]);
      if (cancelled) return;
      setStatus(s);
      // CLI is built-in plumbing — hide it from the UI.
      const visible = c.filter((entry) => entry.type !== 'cli');
      const types = new Set(visible.map((x) => x.type));
      // Surface every channel we ship a panel for, even before adapter
      // registration completes, so credentials can be entered first.
      if (!types.has('whatsapp')) visible.push({ type: 'whatsapp', registered: false, active: false });
      if (!types.has('discord'))  visible.push({ type: 'discord',  registered: false, active: false });
      if (!types.has('telegram')) visible.unshift({ type: 'telegram', registered: false, active: false });
      if (!types.has('slack'))    visible.unshift({ type: 'slack',    registered: false, active: false });
      setChannels(visible);
      setWirings(w);
      setMessagingGroups(mg);
      setSlackStatus(sc);
      setTelegramStatus(tc);
      setDiscordStatus(dc);
      setWhatsAppStatus(wc);
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const handleConnect = async (channelType) => {
    if (channelType !== 'slack' && channelType !== 'discord') return;
    setConnectBusy((s) => ({ ...s, [channelType]: true }));
    setConnectError((s) => ({ ...s, [channelType]: null }));
    try {
      // The redirect URL must match one configured under "Redirect URLs"
      // in the Slack / Discord app AND must reach the FastAPI server's
      // /v1/dispatch/<channel>/oauth/callback route. `getApiOrigin()`
      // returns:
      //   - Electron (app:// or file://):  http://127.0.0.1:26866   (the
      //     Python child process — the platform opens the install URL
      //     in the user's default browser, which CAN reach localhost on
      //     the same machine).
      //   - Web dev (vite):               http://localhost:5173    (vite
      //     proxies /v1/* to the Python server).
      //   - Web docker/prod (traefik):    https://cw-<hash>.localhost
      //     (nginx proxies /v1/* to cowork-gateway).
      if (channelType === 'slack') {
        const redirectUri = `${getApiOrigin()}/v1/dispatch/slack/oauth/callback`;
        const { install_url } = await startSlackOAuth(redirectUri);
        window.open(install_url, '_blank', 'noopener,noreferrer');
      } else {
        // Discord OAuth installs the bot in a guild. The bot token itself
        // is app-level and was set via /discord/config; this flow doesn't
        // mint a per-install token — the callback just records guild_id.
        const redirectUri = `${getApiOrigin()}/v1/dispatch/discord/oauth/callback`;
        const { install_url } = await startDiscordInstall(redirectUri);
        window.open(install_url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setConnectError((s) => ({ ...s, [channelType]: err.message }));
    } finally {
      setConnectBusy((s) => ({ ...s, [channelType]: false }));
    }
  };

  const removeWiring = async (mgId, agId) => {
    try {
      await deleteWiring(mgId, agId);
      refresh();
    } catch (err) {
      window.alert(err.message);
    }
  };

  return (
    <div className="dispatch-view scroll-clean" style={{ flex: 1, overflowY: 'auto' }}>
      <PageHeader
        title="Dispatch"
        subtitle="Wire Anton up to chat platforms — Slack, Telegram, Discord, WhatsApp — and route inbound messages to Anton."
      />
      <div style={{ height: 32 }} />
      <main className="dispatch-content dispatch-content-wide">
        <section className="dispatch-section">
          <header className="dispatch-section-head">
            <h2>Status</h2>
          </header>
          {status ? (
            <p className="dispatch-status-line">
              {status.ready ? 'Dispatch ready · ' : 'Dispatch unavailable · '}
              {status.wiring_count} wiring{status.wiring_count === 1 ? '' : 's'} · {status.active_channels.length} active channel{status.active_channels.length === 1 ? '' : 's'}
            </p>
          ) : (
            <p className="dispatch-status-line">Loading…</p>
          )}
        </section>

        <section className="dispatch-section">
          <header className="dispatch-section-head">
            <h2>Channels</h2>
            <button type="button" className="btn-secondary" onClick={refresh}>
              Refresh
            </button>
          </header>
          <div className="dispatch-channel-grid">
            {channels.map((entry) => (
              <ChannelCard
                key={entry.type}
                entry={entry}
                onConnect={handleConnect}
                busy={connectBusy[entry.type]}
                error={connectError[entry.type]}
                slackStatus={entry.type === 'slack' ? slackStatus : null}
                onSlackStatus={setSlackStatus}
                telegramStatus={entry.type === 'telegram' ? telegramStatus : null}
                onTelegramStatus={setTelegramStatus}
                discordStatus={entry.type === 'discord' ? discordStatus : null}
                onDiscordStatus={setDiscordStatus}
                whatsappStatus={entry.type === 'whatsapp' ? whatsappStatus : null}
                onWhatsAppStatus={setWhatsAppStatus}
              />
            ))}
          </div>
        </section>

        <section className="dispatch-section">
          <header className="dispatch-section-head">
            <h2>Wirings</h2>
          </header>
          <ul className="dispatch-list">
            {wirings.map((w) => {
              // Resolve the messaging-group UUID back to a human-readable
              // label. Messaging groups are populated lazily, so a freshly-
              // wired row may not have its group recorded yet — fall back to
              // a short id in that case.
              const mg = messagingGroups.find((m) => m.id === w.messaging_group_id);
              const channelName = mg
                ? `${CHANNEL_LIBRARY[mg.channel_type]?.name || mg.channel_type} · ${mg.display_name || mg.platform_id}`
                : `${w.messaging_group_id.slice(0, 8)}…`;
              return (
                <WiringRow
                  key={`${w.messaging_group_id}-${w.agent_group_id}`}
                  wiring={w}
                  channelName={channelName}
                  onSaved={(updated) => {
                    setWirings((prev) => prev.map((x) =>
                      x.messaging_group_id === updated.messaging_group_id
                        && x.agent_group_id === updated.agent_group_id
                        ? updated : x));
                    refresh();
                  }}
                  onRemove={() => removeWiring(w.messaging_group_id, w.agent_group_id)}
                />
              );
            })}
            {wirings.length === 0 ? (
              <li className="dispatch-empty">
                No wirings yet — a channel is wired automatically the first time it messages Anton.
              </li>
            ) : null}
          </ul>
        </section>
      </main>
    </div>
  );
}
