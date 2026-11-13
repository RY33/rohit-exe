"use client";

import { useState } from "react";
import {
  AudioLines,
  BrainCircuit,
  Code2,
  Network,
} from "lucide-react";

import ComicPanel from "@/components/ComicPanel";
import ContactModal from "@/components/ContactModal";
import MangaBackground from "@/components/MangaBackground";
import RohitVoiceAgent from "@/components/RohitVoiceAgent";

const skills = [
  { title: "AI Engineer", eyebrow: "Building intelligent systems", icon: BrainCircuit },
  { title: "Voice AI", eyebrow: "Real-time conversations", icon: AudioLines },
  { title: "Full Stack", eyebrow: "From API to interface", icon: Code2 },
  {
    title: "Backend Systems",
    eyebrow: "SCALABLE & DISTRIBUTED ARCHITECTURE",
    icon: Network,
  },
];

export default function Home() {
  const [isContactOpen, setIsContactOpen] = useState(false);

  return (
    <main className="manga-page">
      <MangaBackground />
      <div className="manga-shell">
        <ComicPanel className="hero-panel">
          <span className="hero-kicker">Case file 001 · Rohit Yadav</span>
          <h1 className="hero-title">
            Rohit<span>.exe</span>
          </h1>
          <p className="hero-tagline">
            A human software engineer.
            <br />
            An AI-powered digital representative.
          </p>
          <p className="hero-aside">Zero corporate boringness.</p>
          <span className="hero-note">A new conversation arc begins</span>
          <button
            type="button"
            className="contact-page-button"
            onClick={() => setIsContactOpen(true)}
          >
            Contact Rohit
          </button>
        </ComicPanel>

        <ComicPanel
          className="voice-panel"
          ariaLabel="Talk to Rohit's AI representative"
        >
          <div className="voice-panel-inner">
            <span className="voice-kicker">Your next conversation starts here</span>
            <RohitVoiceAgent
              onConversationEnded={() => setIsContactOpen(true)}
            />
            <span className="voice-annotation" aria-hidden="true">
              tap to connect
            </span>
          </div>
        </ComicPanel>

        <div className="feature-grid" aria-label="Rohit's specialties">
          {skills.map(({ title, eyebrow, icon: Icon }) => (
            <ComicPanel key={title} className="feature-panel">
              <span className="feature-icon">
                <Icon size={21} strokeWidth={2.5} aria-hidden="true" />
              </span>
              <h2 className="feature-title">{title}</h2>
              <span className="feature-eyebrow">{eyebrow}</span>
            </ComicPanel>
          ))}
        </div>

        <footer className="manga-footer">
          You&apos;re talking to an AI representation of Rohit.
        </footer>
      </div>
      <ContactModal
        isOpen={isContactOpen}
        onClose={() => setIsContactOpen(false)}
      />
    </main>
  );
}
