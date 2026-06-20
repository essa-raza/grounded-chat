"use client";

import { useMemo, useState } from "react";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";

import styles from "@/components/chat-demo.module.css";
import {
  getLatestAudit,
  getLatestListings,
  getLatestNotice,
  getLatestStatus,
  getMessageText,
  starterPrompts,
} from "@/components/chat-helpers";
import type { ChatMessage } from "@/lib/types";

export function ChatDemo() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

  const listings = useMemo(() => getLatestListings(messages), [messages]);
  const notice = useMemo(() => getLatestNotice(messages), [messages]);
  const audit = useMemo(() => getLatestAudit(messages), [messages]);
  const streamStatus = useMemo(() => getLatestStatus(messages), [messages]);

  const statusLabel =
    status === "submitted" || status === "streaming"
      ? streamStatus?.label ?? "Thinking"
      : "Online";

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>Grounded Chat</p>
            <h1>Hi, ask me about curated local places.</h1>
            <p className={styles.subhead}>
              I can help with dining, stays, attractions, and venues from this fixed dataset.
            </p>
          </div>
          <span className={styles.statusPill}>{statusLabel}</span>
        </header>

        <section className={styles.chatSurface}>
          <div className={styles.timeline}>
            {messages.length > 0
              ? messages.map((message) => (
                  <article
                    key={message.id}
                    className={`${styles.message} ${
                      message.role === "assistant" ? styles.assistant : styles.user
                    }`}
                  >
                    <span className={styles.role}>
                      {message.role === "assistant" ? "Grounded" : "You"}
                    </span>
                    <p className={styles.text}>{getMessageText(message)}</p>
                  </article>
                ))
              : null}

            {(status === "submitted" || status === "streaming") && streamStatus ? (
              <div className={styles.progressRow}>
                <div className={styles.progressDots}>
                  <span />
                  <span />
                  <span />
                </div>
                <p>{streamStatus.detail ?? streamStatus.label}</p>
              </div>
            ) : null}

            {listings.length > 0 ? (
              <section className={styles.resultsSection}>
                <div className={styles.resultsHeader}>
                  <h2>Recommended now</h2>
                  <span>{listings.length} result{listings.length > 1 ? "s" : ""}</span>
                </div>
                <div className={styles.cardStack}>
                  {listings.map((listing) => (
                    <article key={listing.id} className={styles.card}>
                      <div className={styles.cardTop}>
                        <div>
                          <h3>{listing.name}</h3>
                          <p>{listing.city} / {listing.category}</p>
                        </div>
                        <span className={styles.pricePill}>{listing.priceTier}</span>
                      </div>
                      <p className={styles.cardCopy}>{listing.blurb}</p>
                      <div className={styles.tagRow}>
                        {listing.tags.map((tag) => (
                          <span key={tag} className={styles.tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                      {listing.externalUrl ? (
                        <a
                          className={styles.cardLink}
                          href={listing.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open listing
                        </a>
                      ) : (
                        <span className={styles.cardMuted}>No external link available in the dataset.</span>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          {messages.length === 0 ? (
            <div className={styles.promptCloud}>
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className={styles.promptChip}
                  onClick={() => setInput(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}

          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = input.trim();

              if (!trimmed || status !== "ready") {
                return;
              }

              sendMessage({ text: trimmed });
              setInput("");
            }}
          >
            <textarea
              className={styles.textarea}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={status !== "ready"}
              placeholder="Ask about a place, stay, attraction, or venue..."
            />
            <div className={styles.footerRow}>
              <div className={styles.footerMeta}>
                <span>{notice ?? "AI can be wrong, verify details."}</span>
                {audit?.sanitized ? <span className={styles.safeFlag}>validated</span> : null}
              </div>
              <button className={styles.sendButton} type="submit" disabled={status !== "ready"}>
                {status === "ready" ? "Send" : "Working..."}
              </button>
            </div>
            {error ? <p className={styles.errorText}>{error.message}</p> : null}
          </form>

          <details className={styles.auditPanel}>
            <summary>Safety details</summary>
            <div className={styles.auditBody}>
              <p>Approved IDs: {audit?.approvedIds.join(", ") || "none"}</p>
              <p>
                Invalid references:{" "}
                {audit
                  ? `${audit.invalidIds.join(", ") || "none"} ${audit.invalidUrls.join(", ")}`.trim()
                  : "none"}
              </p>
              <p>Audit logged: {audit?.logged ? "yes" : "no"}</p>
            </div>
          </details>
        </section>
      </section>
    </main>
  );
}
