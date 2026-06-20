"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";

import styles from "@/components/chat-widget-demo.module.css";
import {
  getLatestListings,
  getLatestNotice,
  getLatestStatus,
  getMessageText,
  starterPrompts,
} from "@/components/chat-helpers";
import type { ChatMessage } from "@/lib/types";

export function ChatWidgetDemo() {
  const [open, setOpen] = useState(true);
  const [input, setInput] = useState("");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const { messages, sendMessage, status } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

  const listings = useMemo(() => getLatestListings(messages), [messages]);
  const notice = useMemo(() => getLatestNotice(messages), [messages]);
  const streamStatus = useMemo(() => getLatestStatus(messages), [messages]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      messagesRef.current?.scrollTo({
        top: messagesRef.current.scrollHeight,
        behavior: "smooth",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, open, status]);

  return (
    <main className={styles.page}>
      <section className={styles.content}>
        <p className={styles.eyebrow}>Widget Demo</p>
        <h1>Mini website chat for pricing pages, docs, or landing pages.</h1>
        <p>
          This second surface uses the same grounded backend, but behaves like a
          lower-right website assistant with a launcher and compact panel.
        </p>
        <section className={styles.pricingGrid}>
          <article className={styles.pricingCard}>
            <span className={styles.planTag}>Starter</span>
            <h2>$19</h2>
            <p>Simple local recommendations, grounded answers, and lightweight support flows.</p>
          </article>
          <article className={styles.pricingCard}>
            <span className={styles.planTag}>Growth</span>
            <h2>$49</h2>
            <p>Structured cards, stronger guardrails, and a branded website widget experience.</p>
          </article>
          <article className={styles.pricingCard}>
            <span className={styles.planTag}>Custom</span>
            <h2>Contact</h2>
            <p>Deeper retrieval, real data layers, and production-grade evaluation coverage.</p>
          </article>
        </section>
      </section>

      {open ? (
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Grounded Chat</p>
              <h2>Ask about local places</h2>
              <p>I can answer from the approved dataset only.</p>
            </div>
            <div className={styles.panelActions}>
              <Link className={styles.headerLink} href="/">
                Full page
              </Link>
              <button
                type="button"
                className={styles.close}
                onClick={() => setOpen(false)}
                aria-label="Close chat"
              >
                X
              </button>
            </div>
          </header>

          <div ref={messagesRef} className={styles.messages}>
            {messages.length === 0 ? (
              <article className={`${styles.message} ${styles.assistant}`}>
                <span className={styles.role}>Grounded</span>
                <p className={styles.text}>
                  Hi, I can help with dining, stays, attractions, and venues.
                </p>
              </article>
            ) : (
              messages.map((message) => (
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
            )}
          </div>

          {messages.length === 0 ? (
            <div className={styles.chips}>
              {starterPrompts.slice(0, 3).map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className={styles.chip}
                  onClick={() => setInput(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}

          {(status === "submitted" || status === "streaming") && streamStatus ? (
            <div className={styles.progress}>{streamStatus.detail ?? streamStatus.label}</div>
          ) : null}

          {listings.length > 0 ? (
            <div className={styles.cards}>
              {listings.slice(0, 2).map((listing) => (
                <article key={listing.id} className={styles.card}>
                  <div className={styles.cardRow}>
                    <h3>{listing.name}</h3>
                    <span className={styles.cardPrice}>{listing.priceTier}</span>
                  </div>
                  <p>{listing.city} / {listing.category}</p>
                  {listing.externalUrl ? (
                    <a
                      className={styles.cardLink}
                      href={listing.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open listing -&gt;
                    </a>
                  ) : (
                    <span className={styles.cardMuted}>No external link in dataset.</span>
                  )}
                </article>
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
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  const trimmed = input.trim();

                  if (!trimmed || status !== "ready") {
                    return;
                  }

                  sendMessage({ text: trimmed });
                  setInput("");
                }
              }}
              disabled={status !== "ready"}
              placeholder="Ask about a local place..."
            />
            <div className={styles.footer}>
              <span className={styles.meta}>
                {notice ?? "AI can be wrong, verify details."}
              </span>
              <button className={styles.send} type="submit" disabled={status !== "ready"}>
                {status === "ready" ? "Send" : "Working..."}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <button
        type="button"
        className={styles.launcher}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.launcherDot} />
        {open ? "Hide chat" : "Chat with us"}
      </button>
    </main>
  );
}
