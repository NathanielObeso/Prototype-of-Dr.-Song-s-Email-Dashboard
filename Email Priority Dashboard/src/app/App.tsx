import { useState, useMemo, useEffect, useRef } from "react";
import { Toaster, toast } from "sonner";
import {
  Search,
  Star,
  Archive,
  Trash2,
  RefreshCw,
  ChevronDown,
  Paperclip,
  Circle,
  AlertCircle,
  AlertTriangle,
  Info,
  Mail,
  MailOpen,
  //MoreHorizontal,
  Bell,
  BellRing,
  Clock,
  X,
  //Settings,
  //Inbox,
  Send,
  //FileText,
  Sparkles,
  Eye,
  Reply,
  ShieldAlert,
  //ChevronRight,
  CheckSquare,
  Square,
  CheckCheck,
  Plus,
} from "lucide-react";
import DOMPurify from "dompurify";

type Priority = "critical" | "high" | "normal" | "low";
type Tab = "all" | "unread" | "starred" | "attachments";

interface Email {
  threadId?: string;
  from: string;
  fromEmail: string;
  subject: string;
  preview: string;
  body: string;
  html?: string;
  messages?: Email[]
  images?: any[];
  attachments?: any[];
  time: string;
  date: string;
  priority: string;
  read: boolean;
  starred: boolean;
  hasAttachment: boolean;
  tags: string[];
  avatar: string;
  gmailId: string;
  needsReply?: boolean;
  summary?: string;
  loaded?: boolean;
}

const API_BASE = "http://localhost:5001";

interface Reminder {
  id: string;
  emailId: string;
  triggerAt: Date;
  label: string;
  fired: boolean;
}

const QUICK_REMIND_OPTIONS = [
  { label: "In 30 minutes", minutes: 30 },
  { label: "In 1 hour", minutes: 60 },
  { label: "In 3 hours", minutes: 180 },
  { label: "Tomorrow 9 am", minutes: null as null },
  { label: "Custom…", minutes: -1 },
];

function getTomorrow9am(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

function replaceInlineImages(
  html:string,
  images:any
){
  let output = html;

  Object.entries(images ?? {}).forEach(
    ([cid,img]:any)=>{
      output = output.replace(
        `cid:${cid}`,
        `data:${img.mimeType};base64,${img.data}`
      );
    }
  );

  return output;
}

function openAttachment(att: {
  filename: string;
  mimeType: string;
  data: string;
}) {
  const binary = atob(att.data);

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
  }

  const blob = new Blob([bytes], {
      type: att.mimeType,
  });

  const url = URL.createObjectURL(blob);

  window.open(url, "_blank");

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode; dot: string }> = {
  critical: {
    label: "CRITICAL",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
    icon: <AlertCircle size={11} />,
    dot: "bg-red-500",
  },
  high: {
    label: "HIGH",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    icon: <AlertTriangle size={11} />,
    dot: "bg-amber-400",
  },
  normal: {
    label: "NORMAL",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    icon: <Circle size={11} />,
    dot: "bg-blue-400",
  },
  low: {
    label: "LOW",
    color: "text-muted-foreground",
    bg: "bg-muted/60 border-border",
    icon: <Info size={11} />,
    dot: "bg-muted-foreground",
  },
};

const PRIORITY_ORDER: string[] = ["critical", "high", "normal", "low"];

const TAG_COLORS: Record<string, string> = {
  insurance: "text-red-400 bg-red-500/10",
  billing: "text-red-400 bg-red-500/10",
  denial: "text-red-400 bg-red-500/10",
  appeal: "text-orange-400 bg-orange-500/10",
  npi: "text-orange-400 bg-orange-500/10",
  collections: "text-orange-400 bg-orange-500/10",
  "fee schedule": "text-amber-400 bg-amber-500/10",
  authorization: "text-amber-400 bg-amber-500/10",
  "workers comp": "text-amber-400 bg-amber-500/10",
  scheduling: "text-blue-400 bg-blue-500/10",
  intake: "text-blue-400 bg-blue-500/10",
  referral: "text-cyan-400 bg-cyan-500/10",
  "new patient": "text-cyan-400 bg-cyan-500/10",
  supplies: "text-muted-foreground bg-muted/40",
  order: "text-muted-foreground bg-muted/40",
  licensing: "text-purple-400 bg-purple-500/10",
  compliance: "text-purple-400 bg-purple-500/10",
  hipaa: "text-purple-400 bg-purple-500/10",
  lease: "text-emerald-400 bg-emerald-500/10",
  facilities: "text-emerald-400 bg-emerald-500/10",
  reputation: "text-pink-400 bg-pink-500/10",
  reviews: "text-pink-400 bg-pink-500/10",
  ceu: "text-muted-foreground bg-muted/40",
  education: "text-muted-foreground bg-muted/40",
};

function AvatarBadge({ initials, priority }: { initials: string; priority: string }) {
  const ringColor = {
    critical: "ring-red-500/50",
    high: "ring-amber-400/40",
    normal: "ring-blue-400/30",
    low: "ring-border",
  }[priority];

  return (
    <div
      className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold ring-1 shrink-0 select-none ${ringColor}`}
      style={{ fontFamily: "'Geist Mono', monospace", background: "rgba(255,255,255,0.05)", color: "#a0a0b0" }}
    >
      {initials}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.normal;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium tracking-widest ${cfg.color} ${cfg.bg}`}
      style={{ fontFamily: "'Geist Mono', monospace" }}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function EmailRow({
  email,
  selected,
  onSelect,
  onStar,
  hasReminder,
  isSent,
}: {
  email: Email;
  selected: boolean;
  onSelect: () => void;
  onStar: () => void;
  hasReminder?: boolean;
  isSent?: boolean;
}) {
  const cfg = PRIORITY_CONFIG[email.priority] ?? PRIORITY_CONFIG.normal;
  return (
    <div
      onClick={onSelect}
      className={`group flex items-start gap-3 px-4 py-3 border-b border-border cursor-pointer transition-colors duration-100 relative
        ${selected ? "bg-accent" : email.read ? "hover:bg-accent/50" : "bg-secondary/40 hover:bg-accent/60"}
      `}
    >
      {/* Priority bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${cfg.dot}`} />

      <div className="flex items-center gap-2 shrink-0 mt-0.5">
        <AvatarBadge initials={email.avatar} priority={email.priority} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <div className="flex items-center gap-2 min-w-0">
            {!email.read && (
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
            )}
            <span
              className={`text-[13px] truncate ${email.read ? "text-muted-foreground font-normal" : "text-foreground font-semibold"}`}
            >
              {email.from}
            </span>
            <span
              className="text-[11px] text-muted-foreground truncate hidden sm:block"
              style={{ fontFamily: "'Geist Mono', monospace" }}
            >
              &lt;{email.fromEmail}&gt;
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isSent && (
              <span
                className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium"
                style={{ fontFamily: "'Geist Mono', monospace" }}
              >
                <CheckCheck size={11} />
                sent
              </span>
            )}
            {email.hasAttachment && <Paperclip size={11} className="text-muted-foreground" />}
            {hasReminder && <Clock size={11} className="text-amber-400" />}
            <span
              className="text-[11px] text-muted-foreground whitespace-nowrap"
              style={{ fontFamily: "'Geist Mono', monospace" }}
            >
              {email.date === "Today" ? email.time : email.date}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onStar(); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Star
                size={13}
                className={email.starred ? "text-amber-400 fill-amber-400" : "text-muted-foreground hover:text-amber-400"}
              />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-1">
          <PriorityBadge priority={email.priority} />
          <span className={`text-[13px] truncate ${email.read ? "text-muted-foreground" : "text-foreground"}`}>
            {email.subject}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] text-muted-foreground truncate">{email.preview}</p>
          <div className="flex gap-1 shrink-0">
            {(email.tags ?? []).map((tag) => (
              <span
                key={tag}
                className={`text-[10px] px-1.5 py-px rounded font-medium tracking-wide ${TAG_COLORS[tag] ?? "text-muted-foreground bg-muted/40"}`}
                style={{ fontFamily: "'Geist Mono', monospace" }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const PRIORITY_ACTIONS: Record<string, string> = {
  critical: "Respond immediately — operational impact is ongoing.",
  high: "Respond today — deadline or business consequence imminent.",
  normal: "Respond within 24–48 hours.",
  low: "No urgent action required — review when convenient.",
};

function SectionLabel({ icon, label, color }: { icon: React.ReactNode; label: string; color?: string }) {
  return (
    <div
      className={`flex items-center gap-2 text-[10px] font-semibold tracking-[0.12em] uppercase mb-3 ${color ?? "text-muted-foreground"}`}
      style={{ fontFamily: "'Geist Mono', monospace" }}
    >
      {icon}
      {label}
    </div>
  );
}

function DetailPanel({
  email,
  onClose,
  reminder,
  onAddReminder,
  onClearReminder,
  onSend,
  onStar,
  onArchive,
  onTrash,
  isSent,
}: {
  email: Email;
  onClose: () => void;
  reminder: Reminder | undefined;
  onAddReminder: (emailId: string, triggerAt: Date, label: string) => void;
  onClearReminder: (emailId: string) => void;
  onSend: (emailId: string, body: string, to: string, cc: string) => void;
  onStar: (email: Email) => void;
  onArchive: (email: Email) => void;
  onTrash: (email: Email) => void;
  isSent: boolean;
}) {
  const cfg = PRIORITY_CONFIG[email.priority] ?? PRIORITY_CONFIG.normal;
  const [replyText, setReplyText] = useState("");
  const [toEmail, setToEmail] = useState(email.fromEmail);
  const [ccEmail, setCcEmail] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [customDatetime, setCustomDatetime] = useState("");
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const reminderRef = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setReplyText("");
    setToEmail(email.fromEmail);
    setCcEmail("");
    setShowCc(false);
    setEmailOpen(false);
    setReminderOpen(false);
    setJustSent(false);
    setSending(false);
  }, [email.gmailId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (reminderRef.current && !reminderRef.current.contains(e.target as Node)) {
        setReminderOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function pickQuickOption(opt: (typeof QUICK_REMIND_OPTIONS)[string]) {
    if (opt.minutes === -1) return;
    const triggerAt = opt.minutes === null ? getTomorrow9am() : new Date(Date.now() + opt.minutes * 60_000);
    onAddReminder(email.gmailId, triggerAt, opt.label);
    setReminderOpen(false);
  }

  function pickCustom() {
    if (!customDatetime) return;
    const triggerAt = new Date(customDatetime);
    if (isNaN(triggerAt.getTime()) || triggerAt <= new Date()) return;
    onAddReminder(email.gmailId, triggerAt, "Custom reminder");
    setCustomDatetime("");
    setReminderOpen(false);
  }

  function formatReminderTime(d: Date) {
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffMin = Math.round(diffMs / 60_000);
    if (diffMin < 1) return "in a moment";
    if (diffMin < 60) return `in ${diffMin}m`;
    if (diffMin < 1440) return `in ${Math.round(diffMin / 60)}h`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  const isValidEmail = (addr: string) => addr.trim().length > 0 && addr.includes("@");

  async function handleSend() {
    if (
      sending ||
      !isValidEmail(toEmail) ||
      (!replyText.trim() && attachments.length === 0)
  ) {
      return;
  }
  
    setSending(true);
  
    try {
        
      const formData = new FormData();

      formData.append("email_id", String(email.gmailId));
      formData.append("to", toEmail);
      formData.append("cc", ccEmail);
      formData.append("subject", `Re: ${email.subject}`);
      formData.append("body", replyText);
      
      if (attachments.length > 0) {
        attachments.forEach(file => {
            formData.append("attachments", file);
        });
    }
      
      const response = await fetch(`${API_BASE}/api/send`, {
          method: "POST",
          body: formData
      });
  
      const data = await response.json();
  
      if (!response.ok || !data.success) {
         throw new Error("Failed to send email");
       }
  
      setSentTo(toEmail.trim());
      setReplyText("");
      setJustSent(true);
  
    } catch (err) {
      console.error("Send failed:", err);
      alert("Failed to send email");
    } finally {
      setSending(false);
    }

    onSend(email.gmailId, replyText, toEmail.trim(), ccEmail.trim());
  }

  const summary = email.summary ?? "Generating AI summary...";
  const action = PRIORITY_ACTIONS[email.priority] ?? PRIORITY_ACTIONS.normal;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-border flex items-start justify-between gap-4 shrink-0">
        <div className="flex items-start gap-3 min-w-0">
          <AvatarBadge initials={email.avatar} priority={email.priority} />
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-foreground leading-snug truncate">{email.subject}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-muted-foreground">{email.from}</span>
              <span className="text-muted-foreground/40">·</span>
              <span
                className="text-[11px] text-muted-foreground"
                style={{ fontFamily: "'Geist Mono', monospace" }}
              >
                {email.date === "Today" ? `Today ${email.time}` : `${email.date}`}
              </span>
              {email.hasAttachment && <Paperclip size={10} className="text-muted-foreground" />}
              {isSent && (
                <span
                  className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium"
                  style={{ fontFamily: "'Geist Mono', monospace" }}
                >
                  <CheckCheck size={11} />
                  replied
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Reminder button */}
          <div className="relative" ref={reminderRef}>
            <button
              onClick={() => setReminderOpen((o) => !o)}
              className={`p-1.5 rounded transition-colors ${
                reminder
                  ? "text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              title="Set reminder"
            >
              {reminder ? <BellRing size={13} /> : <Bell size={13} />}
            </button>

            {reminderOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-border">
                  <p className="text-[11px] font-semibold text-foreground tracking-wide">Remind me to reply</p>
                  {reminder && (
                    <p className="text-[10px] text-amber-400 mt-0.5" style={{ fontFamily: "'Geist Mono', monospace" }}>
                      Set for {formatReminderTime(reminder.triggerAt)}
                    </p>
                  )}
                </div>
                <div className="py-1">
                  {QUICK_REMIND_OPTIONS.filter((o) => o.minutes !== -1).map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => pickQuickOption(opt)}
                      className="w-full text-left px-3 py-2 text-[12px] text-foreground/80 hover:bg-accent hover:text-foreground transition-colors flex items-center gap-2"
                    >
                      <Clock size={11} className="text-muted-foreground shrink-0" />
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="px-3 py-2.5 border-t border-border space-y-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "'Geist Mono', monospace" }}>Custom</p>
                  <input
                    type="datetime-local"
                    value={customDatetime}
                    onChange={(e) => setCustomDatetime(e.target.value)}
                    className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-amber-500/50 transition-colors"
                    style={{ fontFamily: "'Geist Mono', monospace" }}
                  />
                  <button
                    onClick={pickCustom}
                    disabled={!customDatetime}
                    className="w-full py-1.5 rounded text-[11px] font-medium transition-colors bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ fontFamily: "'Geist Mono', monospace" }}
                  >
                    Set reminder
                  </button>
                </div>
                {reminder && (
                  <div className="px-3 py-2 border-t border-border">
                    <button
                      onClick={() => { onClearReminder(email.gmailId); setReminderOpen(false); }}
                      className="w-full text-left text-[11px] text-red-400/70 hover:text-red-400 transition-colors flex items-center gap-2"
                    >
                      <X size={11} />
                      Clear reminder
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
  onClick={() => onArchive(email)}
  className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
  title="Archive"
>
  <Archive size={13} />
</button>
<button
  onClick={() => onTrash(email)}
  className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
  title="Trash"
>
  <Trash2 size={13} />
</button>
          {/* <button className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <MoreHorizontal size={13} />
          </button> */}
        </div>
      </div>

      {/* Active reminder banner */}
      {reminder && (
        <div className="px-5 py-2.5 border-b border-amber-500/20 bg-amber-500/5 flex items-center gap-2 shrink-0">
          <Clock size={11} className="text-amber-400 shrink-0" />
          <p className="text-[11px] text-amber-400 flex-1" style={{ fontFamily: "'Geist Mono', monospace" }}>
            Reminder set · {reminder.label} · {formatReminderTime(reminder.triggerAt)}
          </p>
          <button
            onClick={() => onClearReminder(email.gmailId)}
            className="text-amber-400/50 hover:text-amber-400 transition-colors"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* Four panels */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="divide-y divide-border">

          {/* 1 — Summary */}
          <div className="px-5 py-4">
            <SectionLabel icon={<Sparkles size={11} />} label="Summary" color="text-violet-400" />
            <p className="text-[13px] text-foreground/85 leading-relaxed">{summary}</p>
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {(email.tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className={`text-[10px] px-1.5 py-px rounded font-medium tracking-wide ${TAG_COLORS[tag] ?? "text-muted-foreground bg-muted/40"}`}
                  style={{ fontFamily: "'Geist Mono', monospace" }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* 2 — Priority */}
          <div className="px-5 py-4">
            <SectionLabel icon={<ShieldAlert size={11} />} label="Priority" color={cfg.color} />
            <div className={`rounded-lg border p-4 ${cfg.bg}`}>
              <div className="flex items-center justify-between mb-3">
                <PriorityBadge priority={email.priority} />
                <div className="flex gap-1">
                  {PRIORITY_ORDER.map((p) => (
                    <div
                      key={p}
                      className={`h-1.5 w-8 rounded-full transition-all ${
                        PRIORITY_ORDER.indexOf(p) <= PRIORITY_ORDER.indexOf(email.priority)
                          ? p === "critical" ? "bg-red-500"
                            : p === "high" ? "bg-amber-400"
                            : p === "normal" ? "bg-blue-400"
                            : "bg-muted-foreground/30"
                          : "bg-border"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <p className={`text-[12px] font-medium mb-3 ${cfg.color}`}>{action}</p>
              <div className="space-y-1.5">
              </div>
            </div>
          </div>

          {/* 3 — View Email */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <SectionLabel icon={<Eye size={11} />} label="Email" />
              <button
                onClick={() => setEmailOpen(!emailOpen)}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                style={{ fontFamily: "'Geist Mono', monospace" }}
              >
                {emailOpen ? "collapse" : "expand"}
                <ChevronDown
                  size={11}
                  className={`transition-transform duration-200 ${emailOpen ? "rotate-180" : ""}`}
                />
              </button>
            </div>

            <div
              className={`overflow-hidden transition-all duration-300 ${emailOpen ? "max-h-none" : "max-h-24 overflow-hidden"}`}
              style={{ position: "relative" }}
            >
              <div className="text-[13px] text-foreground/80 leading-relaxed space-y-3">
              {email.html ? (
                  <div
                    className="email-content text-[13px] text-foreground/80 leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(
                        replaceInlineImages(
                          email.html,
                          email.images
                        ),
                        {
                          ADD_TAGS:["img"],
                          ADD_ATTR:[
                            "src",
                            "style",
                            "width",
                            "height"
                          ]
                        }
                      )
                    }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-sans text-[13px] text-foreground/80">
                    {email.body}
                  </pre>
                )}
                {(email.attachments?.length ?? 0) > 0 && (
                <div className="mt-6 border-t border-border pt-4">
                  <h3 className="text-sm font-medium mb-3">
                    Attachments
                  </h3>

                  <div className="space-y-2">
                    {email.attachments.map((att, i) => (
                      <button
                        key={i}
                        onClick={() => openAttachment(att)}
                        className="w-full flex items-center justify-between rounded border border-border bg-secondary px-3 py-2 hover:bg-accent"
                      >
                        <div className="flex items-center gap-2">
                          <Paperclip size={14} />
                          <div className="text-left">
                            <div>{att.filename}</div>
                            <div className="text-xs text-muted-foreground">
                              {att.mimeType}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
                <p className="text-muted-foreground">
                  Best regards,<br />
                  <span className="text-foreground/70 font-medium">{email.from}</span><br />
                  <span
                    className="text-[11px]"
                    style={{ fontFamily: "'Geist Mono', monospace" }}
                  >
                    {email.fromEmail}
                  </span>
                </p>
              </div>
              {!emailOpen && (
                <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-background to-transparent pointer-events-none" />
              )}
            </div>
          </div>

          {/* 4 — Reply */}
          <div className="px-5 py-4">
            <SectionLabel icon={<Reply size={11} />} label="Reply" color="text-emerald-400" />

            {justSent ? (
              /* Sent confirmation */
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-5 flex flex-col items-center gap-2 text-center">
                <CheckCheck size={20} className="text-emerald-400" />
                <p className="text-[13px] font-medium text-emerald-400">Reply sent</p>
                <p className="text-[11px] text-muted-foreground">
                  Your message was sent to <span className="text-foreground/70" style={{ fontFamily: "'Geist Mono', monospace" }}>{sentTo}</span>
                </p>
                <button
                  onClick={() => setJustSent(false)}
                  className="mt-1 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                >
                  Write another reply
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-secondary overflow-hidden focus-within:border-emerald-500/40 transition-colors">

                {/* To row — editable */}
                <div className="px-3 py-2 border-b border-border flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground shrink-0 w-5" style={{ fontFamily: "'Geist Mono', monospace" }}>
                    To:
                  </span>
                  <input
                    type="email"
                    value={toEmail}
                    onChange={(e) => setToEmail(e.target.value)}
                    className={`flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/40 transition-colors ${
                      toEmail && !isValidEmail(toEmail) ? "text-red-400" : "text-foreground/80"
                    }`}
                    style={{ fontFamily: "'Geist Mono', monospace" }}
                    placeholder="recipient@example.com"
                  />
                  {!showCc && (
                    <button
                      onClick={() => setShowCc(true)}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      style={{ fontFamily: "'Geist Mono', monospace" }}
                    >
                      <Plus size={10} />
                      CC
                    </button>
                  )}
                </div>

                {/* CC row — toggleable */}
                {showCc && (
                  <div className="px-3 py-2 border-b border-border flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground shrink-0 w-5" style={{ fontFamily: "'Geist Mono', monospace" }}>
                      CC:
                    </span>
                    <input
                      type="email"
                      value={ccEmail}
                      onChange={(e) => setCcEmail(e.target.value)}
                      autoFocus
                      className="flex-1 bg-transparent text-[11px] text-foreground/80 outline-none placeholder:text-muted-foreground/40"
                      style={{ fontFamily: "'Geist Mono', monospace" }}
                      placeholder="cc@example.com"
                    />
                    <button
                      onClick={() => { setShowCc(false); setCcEmail(""); }}
                      className="text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0"
                    >
                      <X size={11} />
                    </button>
                  </div>
                )}

                {/* Subject re: row */}
                <div className="px-3 py-2 border-b border-border flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground shrink-0 w-5" style={{ fontFamily: "'Geist Mono', monospace" }}>
                    Re:
                  </span>
                  <span className="text-[11px] text-muted-foreground/50 truncate" style={{ fontFamily: "'Geist Mono', monospace" }}>
                    {email.subject}
                  </span>
                </div>

                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Write your reply…`}
                  rows={5}
                  className="w-full bg-transparent px-3 py-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none resize-none leading-relaxed"
                />

                <div className="px-3 py-2.5 border-t border-border flex items-center justify-between">
                  <div className="flex gap-2">
                  <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (!e.target.files) return;

                  setAttachments(prev => [
                    ...prev,
                    ...Array.from(e.target.files)
                  ]);
                }}
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              >
                <Paperclip size={13} />
              </button>
              {attachments.length > 0 && (
                <div className="px-3 py-2 border-t border-border space-y-1">
                  {attachments.map((file, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs"
                    >
                      <span>{file.name}</span>

                      <button
                        onClick={() =>
                          setAttachments(prev =>
                            prev.filter((_, index) => index !== i)
                          )
                        }
                      >
                        <X size={12}/>
                      </button>
                    </div>
                  ))}
                </div>
              )}
                    <button
  onClick={() => onStar(email)}
  className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
>
  <Star
    size={13}
    className={
      email.starred
        ? "text-amber-400 fill-amber-400"
        : "text-muted-foreground hover:text-amber-400"
    }
  />
</button>
                  </div>
                  <button
                    onClick={handleSend}
                    disabled={
                      (!replyText.trim() && attachments.length === 0) ||
                      !isValidEmail(toEmail) ||
                      sending
                    }
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all
                      ${replyText.trim() && isValidEmail(toEmail) && !sending
                        ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30"
                        : "bg-muted text-muted-foreground border border-border cursor-not-allowed opacity-50"
                      }`}
                    style={{ fontFamily: "'Geist Mono', monospace" }}
                  >
                    <Send size={11} className={sending ? "animate-pulse" : ""} />
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activePriorityFilter, setActivePriorityFilter] = useState<string | null>(null);
  // repliedIds: emails that have been checked off (sent or manually ticked)
  const [repliedIds, setRepliedIds] = useState<Set<string>>(new Set());
  // sentIds: emails where a reply was actually composed and sent in-app
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadMoreRef = useRef<HTMLDivElement>(null);

  const emailsRef = useRef<Email[]>([]);
  useEffect(() => {
    emailsRef.current = emails;
  }, [emails]);

  const fetchEmails = async (pageToken?: string) => {
    try {
      console.log("fetchEmails received:", pageToken, typeof pageToken);


      setLoading(true);
  
      const url = new URL(`${API_BASE}/api/emails`);

      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
  
      const result = await response.json();

      console.log("Full response:", result);
console.log("nextPageToken:", result.nextPageToken);
console.log("Type:", typeof result.nextPageToken);

      const rawData = result.emails;
      setNextPageToken(result.nextPageToken ?? null);

      console.log(result.nextPageToken);
      console.log(typeof result.nextPageToken);
  
      const data: Email[] = rawData.map((thread: any) => {
      const latest = thread.messages?.[thread.messages.length - 1] ?? {};
  
        return {
          threadId: thread.threadId,

          gmailId: latest.id ?? thread.threadId,
  
          from: latest.from ?? "Unknown",
          fromEmail: latest.fromEmail ?? "",
  
          subject: thread.subject ?? latest.subject ?? "(No subject)",
  
          preview: latest.body?.slice(0, 150) ?? "",
          body: latest.body ?? "",
          html: latest.html ?? "",

          summary: latest.summary ?? "",
  
          images: latest.images ?? [],
          attachments: latest.attachments ?? [],
  
          time: latest.time ?? "",
          date: latest.date ?? "",
  
          priority: (() => {
            const p = String(latest.priority ?? "normal")
              .toLowerCase()
              .trim();
          
            return PRIORITY_CONFIG[p] ? p : "normal";
          })(),
  
          read: latest.labelIds?.includes("UNREAD") ? false : true,
          starred: latest.labelIds?.includes("STARRED") ?? false,
  
          hasAttachment:
            (latest.attachments?.length ?? 0) > 0,
  
          tags: latest.tags ?? [],
  
          avatar:
            (latest.from ?? "??")
              .slice(0, 2)
              .toUpperCase(),
        };
      });
  
      setEmails(prev => [...prev, ...data]);
      setSelectedId((prev) => prev ?? data[0]?.threadId ?? null);
  
    } catch (err) {
      console.error("Failed to fetch emails:", err);
      setError("Couldn't reach the email server");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;

    const selectedEmail = emails.find(
        email => email.threadId === selectedId
    );

    if (selectedEmail?.loaded) return;

    fetch(`${API_BASE}/api/thread/${selectedId}`)
        .then(r => r.json())
        .then(thread => {
          const latest = thread.messages?.[thread.messages.length - 1] ?? {};
      
          const updatedEmail = {
              ...selectedEmail,
      
              body: latest.body ?? "",
              html: latest.html ?? "",
      
              images: latest.images ?? [],
              attachments: latest.attachments ?? [],

              loaded: true,
      
              from: latest.from ?? selectedEmail?.from,
              fromEmail: latest.fromEmail ?? selectedEmail?.fromEmail,
      
              priority:
                latest.priority?.toLowerCase() ??
                selectedEmail?.priority ??
                "normal",
      
              tags: latest.tags ?? selectedEmail?.tags ?? [],
      
              hasAttachment:
                (latest.attachments?.length ?? 0) > 0,
          };
      
          setEmails(prev =>
              prev.map(email =>
                  email.threadId === selectedId
                      ? updatedEmail
                      : email
              )
          );
      })
        .catch(console.error);

}, [selectedId]);

  useEffect(() => {
    if (!loadMoreRef.current || !nextPageToken || loadingMore) return;
  
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          fetchEmails(nextPageToken);
        }
      },
      {
        rootMargin: "200px",
      }
    );
  
    observer.observe(loadMoreRef.current);
  
    return () => observer.disconnect();
  }, [nextPageToken, loadingMore]);

  // Auto-populate needs-reply: critical, high, and normal (medium) priority; exclude low
  const needsReplyIds = useMemo(
    () => new Set(emails.filter((e) => e.priority !== "low").map((e) => e.gmailId)),
    [emails]
  );

  const toggleReplied = async (email: Email) => {
    try {
      await fetch(`${API_BASE}/api/replied`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gmailId: email.gmailId,
        }),
      });

    setRepliedIds((prev) => {
      const next = new Set(prev);
      if (next.has(email.gmailId)) 
        next.delete(email.gmailId);
      else
        next.add(email.gmailId);
      return next;
    });
    } catch (err) {
      console.error(err);
    }
  };

  // Called when the user clicks Send in the reply panel
  const handleSend = (emailId: string, body: string, to: string, cc: string) => {
    setSentIds((prev) => new Set([...prev, emailId]));
    setRepliedIds((prev) => new Set([...prev, emailId]));
    setEmails((prev) => prev.map((e) => (e.gmailId === emailId ? { ...e, read: true } : e)));

    const description = cc ? `To: ${to}  ·  CC: ${cc}` : `To: ${to}`;
    toast("Reply sent", {
      description,
      duration: 5_000,
      icon: <CheckCheck size={14} className="text-emerald-400" />,
    });
  };

  const addReminder = (emailId: string, triggerAt: Date, label: string) => {
    setReminders((prev) => [
      ...prev.filter((r) => r.emailId !== emailId),
      { id: `${emailId}-${Date.now()}`, emailId, triggerAt, label, fired: false },
    ]);
  };

  const clearReminder = (emailId: string) => {
    setReminders((prev) => prev.filter((r) => r.emailId !== emailId));
  };

  // Poll every 20s for due reminders
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setReminders((prev) =>
        prev.map((r) => {
          if (!r.fired && r.triggerAt <= now) {
            const email = emailsRef.current.find((e) => e.threadId === r.emailId);
            toast("Reminder: reply to this email", {
              description: email?.subject ?? "Check your inbox",
              duration: 10_000,
              action: {
                label: "View",
                onClick: () => setSelectedId(r.emailId),
              },
              icon: <BellRing size={14} className="text-amber-400" />,
            });
            return { ...r, fired: true };
          }
          return r;
        })
      );
    }, 20_000);
    return () => clearInterval(interval);
  }, []);

  const selectedEmail = emails.find((e) => e.threadId === selectedId) ?? null;

  useEffect(() => {
    if (!selectedEmail) return;
    if (selectedEmail.summary) return;

    const interval = setInterval(async () => {
        const res = await fetch(
            `${API_BASE}/api/summary/${selectedEmail.gmailId}`
        );

        const data = await res.json();

        if (data.summary) {
            setEmails(prev =>
                prev.map(email =>
                    email.gmailId === selectedEmail.gmailId
                        ? {
                              ...email,
                              summary: data.summary,
                              priority: data.priority,
                          }
                        : email
                )
            );

            clearInterval(interval);
        }
    }, 2000);

    return () => clearInterval(interval);
}, [selectedEmail]);

  const filteredEmails = useMemo(() => {
    let list = emails;
    if (activeTab === "unread") list = list.filter((e) => !e.read);
    if (activeTab === "starred") list = list.filter((e) => e.starred);
    if (activeTab === "attachments") list = list.filter((e) => e.hasAttachment);
    if (activePriorityFilter) list = list.filter((e) => e.priority === activePriorityFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (e) =>
          e.from.toLowerCase().includes(q) ||
          e.subject.toLowerCase().includes(q) ||
          e.preview.toLowerCase().includes(q)
      );
    }
    return [...list].sort(
      (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
    );
  }, [emails, activeTab, searchQuery, activePriorityFilter]);

  const counts = useMemo(() => ({
    all: emails.length,
    unread: emails.filter((e) => !e.read).length,
    starred: emails.filter((e) => e.starred).length,
    attachments: emails.filter((e) => e.hasAttachment).length,
    critical: emails.filter((e) => e.priority === "critical" && !e.read).length,
  }), [emails]);

  const toggleStar = async (email: Email) => {
    try {
      const response = await fetch(
        `${API_BASE}/api/emails/${email.gmailId}/star`,
        {
          method: "POST",
        }
      );

      console.log("Star response:", response.status);

      if (!response.ok) {
        throw new Error("Failed to update star");
      }
  
      const data = await response.json();
      console.log("Star data:", data);
  
      setEmails((prev) =>
        prev.map((e) =>
          e.gmailId === email.gmailId
            ? { ...e, starred: data.starred }
            : e
        )
      );
  
    } catch (err) {
      console.error("Failed to toggle star:", err);
    }
  };

  const archiveEmail = async (email: Email) => {
    try {
      const response = await fetch(
        `${API_BASE}/api/emails/${email.gmailId}/archive`,
        {
          method: "POST",
        }
      );
  
      if (!response.ok) {
        throw new Error("Failed to archive email");
      }
  
      // Remove from frontend immediately
      setEmails((prev) =>
        prev.filter((e) => e.gmailId !== email.gmailId)
      );
  
      if (selectedId === email.threadId) {
        setSelectedId(null);
      }
  
      toast("Email archived", {
        description: email.subject,
        duration: 3000,
      });
  
    } catch (err) {
      console.error("Archive failed:", err);
      toast.error("Failed to archive email");
    }
  };

  const trashEmail = async (email: Email) => {
    try {
      const response = await fetch(
        `${API_BASE}/api/emails/${email.gmailId}/trash`,
        {
          method: "POST",
        }
      );
  
      if (!response.ok) {
        throw new Error("Failed to trash email");
      }
  
      setEmails((prev) =>
        prev.filter((e) => e.gmailId !== email.gmailId)
      );
  
      if (selectedId === email.threadId) {
        setSelectedId(null);
      }
  
      toast("Email moved to trash", {
        description: email.subject,
        duration: 3000,
      });
  
    } catch (err) {
      console.error("Trash failed:", err);
      toast.error("Failed to move email to trash");
    }
  };

  const markAsRead = async (email: Email) => {
    try {
      await fetch(`${API_BASE}/api/read/${email.threadId}`, {
        method: "POST",
      });
  
      setEmails(prev =>
        prev.map(e =>
          e.threadId === email.threadId
            ? { ...e, read: true }
            : e
        )
      );
    } catch (err) {
      console.error("Failed to mark read:", err);
    }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "starred", label: "Starred" },
    { key: "attachments", label: "Attachments" },
  ];

  return (
    <div
      className="flex h-screen w-full bg-background text-foreground overflow-hidden"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Sidebar */}
      <aside className="w-52 shrink-0 border-r border-border flex flex-col bg-card hidden lg:flex">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary/20 flex items-center justify-center">
              <Mail size={13} className="text-primary" />
            </div>
            <span className="text-[13px] font-semibold text-foreground tracking-tight">Inbox</span>
          </div>
        </div>

        {/* Scrollable middle */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          {/* Folder nav
          <nav className="py-3 px-2 space-y-0.5">
            {[
              { icon: <Inbox size={14} />, label: "Inbox", count: counts.unread, active: true },
              { icon: <Send size={14} />, label: "Sent", count: sentIds.size, active: false },
              { icon: <FileText size={14} />, label: "Drafts", count: 2, active: false },
              { icon: <Archive size={14} />, label: "Archive", count: 0, active: false },
              { icon: <Trash2 size={14} />, label: "Trash", count: 0, active: false },
            ].map((item) => (
              <button
                key={item.label}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[13px] transition-colors
                  ${item.active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-accent"}
                `}
              >
                <div className="flex items-center gap-2.5">
                  {item.icon}
                  {item.label}
                </div>
                {item.count > 0 && (
                  <span
                    className={`text-[10px] px-1.5 py-px rounded font-semibold ${item.active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}
                    style={{ fontFamily: "'Geist Mono', monospace" }}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            ))}
          </nav> */}

          {/* Priority filters */}
          <div className="px-4 py-3 border-t border-border">
            <p
              className="text-[10px] font-medium text-muted-foreground tracking-widest mb-2 uppercase"
              style={{ fontFamily: "'Geist Mono', monospace" }}
            >
              Filter by Priority
            </p>
            <div className="space-y-0.5">
              {PRIORITY_ORDER.map((p) => {
                const cfg = PRIORITY_CONFIG[p] ?? PRIORITY_CONFIG.normal;
                const cnt = emails.filter((e) => e.priority === p).length;
                return (
                  <button
                    key={p}
                    onClick={() => setActivePriorityFilter(activePriorityFilter === p ? null : p)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-[12px] transition-colors
                      ${activePriorityFilter === p ? `${cfg.bg} ${cfg.color}` : "text-muted-foreground hover:text-foreground hover:bg-accent"}
                    `}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      <span style={{ fontFamily: "'Geist Mono', monospace" }} className="text-[11px] tracking-wide">
                        {cfg.label}
                      </span>
                    </div>
                    <span style={{ fontFamily: "'Geist Mono', monospace" }} className="text-[11px]">{cnt}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Needs Reply checklist — auto-populated for critical / high / normal */}
          <div className="px-4 py-3 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <p
                className="text-[10px] font-medium text-muted-foreground tracking-widest uppercase"
                style={{ fontFamily: "'Geist Mono', monospace" }}
              >
                Needs Reply
              </p>
              <span
                className="text-[10px] text-muted-foreground"
                style={{ fontFamily: "'Geist Mono', monospace" }}
              >
                {repliedIds.size}/{needsReplyIds.size}
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-0.5 bg-border rounded-full mb-3 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${needsReplyIds.size > 0 ? (repliedIds.size / needsReplyIds.size) * 100 : 0}%` }}
              />
            </div>

            <div className="space-y-px">
              {PRIORITY_ORDER.filter((p) => p !== "low").map((p) => {
                const groupEmails = emails.filter(
                  (e) => e.priority === p && needsReplyIds.has(e.gmailId)
                );
                if (groupEmails.length === 0) return null;
                const cfg = PRIORITY_CONFIG[p] ?? PRIORITY_CONFIG.normal;
                return (
                  <div key={p} className="mb-2">
                    <div
                      className={`text-[9px] font-semibold tracking-[0.14em] uppercase mb-1 flex items-center gap-1 ${cfg.color}`}
                      style={{ fontFamily: "'Geist Mono', monospace" }}
                    >
                      <div className={`w-1 h-1 rounded-full ${cfg.dot}`} />
                      {cfg.label}
                    </div>
                    {groupEmails.map((e) => {
                      const done = repliedIds.has(e.gmailId);
                      const sent = sentIds.has(e.gmailId);
                      return (
                        <button
                          key={e.gmailId}
                          onClick={() => {
                            if (!sent) toggleReplied(e);
                            setSelectedId(e.threadId);
                            setEmails((prev) =>
                              prev.map((m) => (m.gmailId === e.gmailId ? { ...m, read: true } : m))
                            );
                          }}
                          className={`w-full flex items-start gap-2 px-1.5 py-1.5 rounded text-left transition-colors group
                            ${done ? "opacity-40" : "hover:bg-accent"}
                          `}
                        >
                          <span className={`shrink-0 mt-px transition-colors ${
                            sent ? "text-emerald-500"
                            : done ? "text-emerald-500"
                            : "text-muted-foreground/40 group-hover:text-muted-foreground"
                          }`}>
                            {done ? <CheckSquare size={12} /> : <Square size={12} />}
                          </span>
                          <span
                            className={`text-[11px] leading-tight line-clamp-2 ${done ? "line-through text-muted-foreground" : "text-foreground/80"}`}
                          >
                            {e.from}
                            {sent && (
                              <span className="ml-1 text-emerald-400 not-italic no-underline" style={{ textDecoration: "none" }}>✓</span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* User footer
        <div className="px-4 py-3 border-t border-border flex items-center gap-2 shrink-0">
          {/* <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-[11px] font-semibold text-primary" style={{ fontFamily: "'Geist Mono', monospace" }}>
            YK
          </div>
          {/* <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-foreground truncate">You Kim</p>
            <p className="text-[10px] text-muted-foreground truncate" style={{ fontFamily: "'Geist Mono', monospace" }}>you@goldmeridian.com</p>
          </div>
          <Settings size={13} className="text-muted-foreground shrink-0" />
        </div> */}
      </aside>

      {/* Email list */}
      <div className="w-full lg:w-[420px] shrink-0 flex flex-col border-r border-border overflow-hidden">
        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <div className="flex-1 relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search emails…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-secondary border border-border rounded-md pl-8 pr-3 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          <button
            onClick={() => fetchEmails()}
            disabled={loading}
            title="Refresh"
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          {/* <button className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <Bell size={13} />
          </button> */}
        </div>

        {error && (
          <div className="px-4 py-2 border-b border-border bg-red-500/10 text-red-400 text-[11px] flex items-center gap-2">
            <AlertCircle size={12} className="shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center border-b border-border px-4">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative py-2.5 px-3 text-[12px] font-medium transition-colors flex items-center gap-1.5
                ${activeTab === tab.key ? "text-foreground" : "text-muted-foreground hover:text-foreground"}
              `}
            >
              {tab.label}
              {(tab.key === "unread" && counts.unread > 0) && (
                <span
                  className="text-[10px] bg-primary/20 text-primary px-1.5 py-px rounded font-semibold"
                  style={{ fontFamily: "'Geist Mono', monospace" }}
                >
                  {counts.unread}
                </span>
              )}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
              )}
            </button>
          ))}
          {activePriorityFilter && (
            <div className="ml-auto flex items-center gap-1">
              <span
                className={`text-[10px] px-1.5 py-px rounded border font-medium ${PRIORITY_CONFIG[activePriorityFilter].color} ${PRIORITY_CONFIG[activePriorityFilter].bg}`}
                style={{ fontFamily: "'Geist Mono', monospace" }}
              >
                {PRIORITY_CONFIG[activePriorityFilter].label}
              </span>
              <button
                onClick={() => setActivePriorityFilter(null)}
                className="text-muted-foreground hover:text-foreground text-[11px] transition-colors"
              >
                ×
              </button>
            </div>
          )}
        </div>

        {/* Summary bar */}
        <div
          className="px-4 py-2 border-b border-border flex items-center justify-between"
          style={{ fontFamily: "'Geist Mono', monospace" }}
        >
          <span className="text-[11px] text-muted-foreground">
            {filteredEmails.length} messages
            {counts.critical > 0 && (
              <span className="ml-2 text-red-400 font-medium">{counts.critical} critical unread</span>
            )}
          </span>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span>sorted by priority</span>
            <ChevronDown size={11} />
          </div>
        </div>

        {/* Email rows */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          {loading && filteredEmails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <RefreshCw size={24} className="opacity-30 animate-spin" />
              <p className="text-[13px]">Loading emails…</p>
            </div>
          ) : filteredEmails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <MailOpen size={32} className="opacity-30" />
              <p className="text-[13px]">No messages found</p>
            </div>
          ) : (
            <>
            {filteredEmails.map((email) => (
              <EmailRow
                key={email.gmailId}
                email={email}
                selected={selectedId === email.threadId}
                onSelect={() => {
                  setSelectedId(email.threadId);
                
                  if (!email.read) {
                    markAsRead(email);
                  }
                }}
                onStar={() => toggleStar(email)}
                hasReminder={reminders.some((r) => r.emailId === email.gmailId && !r.fired)}
                isSent={sentIds.has(email.gmailId)}
              />
            ))}

        {/* Infinite-scroll sentinel */}
      {nextPageToken && (
        <div
          ref={loadMoreRef}
          className="h-10 flex items-center justify-center"
        >
          {loadingMore && (
            <RefreshCw size={16} className="animate-spin text-muted-foreground" />
          )}
        </div>
      )}
    </>
  )}
</div>

</div>

      {/* Detail panel */}
      <main className="flex-1 min-h-0 overflow-hidden hidden lg:block">
        {selectedEmail ? (
          <DetailPanel
            email={selectedEmail}
            onClose={() => setSelectedId(null)}
            reminder={reminders.find((r) => r.emailId === selectedEmail.gmailId && !r.fired)}
            onAddReminder={addReminder}
            onClearReminder={clearReminder}
            onSend={handleSend}
            onStar={toggleStar}
            onArchive={archiveEmail}
            onTrash={trashEmail}
            isSent={sentIds.has(selectedEmail.gmailId)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <MailOpen size={40} className="opacity-20" />
            <p className="text-[14px]">Select an email to read</p>
          </div>
        )}
      </main>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "#111118",
            border: "1px solid rgba(245,158,11,0.2)",
            color: "#e2e2e8",
            fontFamily: "'Inter', sans-serif",
            fontSize: "13px",
          },
        }}
      />
    </div>
  );
}
