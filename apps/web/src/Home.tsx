import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { PersonaSprite } from "./sprites";
import { LogoMark } from "./Logo";
import { FALLBACK_PERSONAS, PERSONA_META, personaStyle } from "./lib/council";
import { PressureControl } from "./Pressure";

const DEMO = {
  question: "I want to charge $12 a month for my habit-tracker app. Smart move?",
  mode: "Shark Tank",
  turns: [
    {
      speaker: "Devil",
      text: "Habit trackers have some of the worst retention on the App Store. Your real competitor is the free Notes app, and it's winning."
    },
    {
      speaker: "Tyson",
      text: "Unless it's social. Streaks your friends can see, and see you break. Make quitting embarrassing and the app markets itself."
    },
    {
      speaker: "Bison",
      text: "Ship the solo version in two weekends first. Social is version two. Scope creep kills more apps than competitors do."
    },
    {
      speaker: "Bucks",
      text: "$12 is a Netflix price for a checkbox. Try $4 a month or $29 a year, then sell team plans to running clubs."
    },
    {
      speaker: "Anshu",
      text: "Find out why people quit on a Tuesday night. Solve that moment and the price will feel small."
    }
  ]
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function Portrait({ name, talking = false, className = "" }: { name: string; talking?: boolean; className?: string }) {
  return (
    <span className={`portrait ${className}`} style={personaStyle(name)} data-talking={talking}>
      <PersonaSprite name={name} talking={talking} />
    </span>
  );
}

function CouncilDemo() {
  const reduced = prefersReducedMotion();
  const total = DEMO.turns.length;
  const [started, setStarted] = useState(reduced);
  const [step, setStep] = useState(reduced ? total : 0);
  const [chars, setChars] = useState(0);
  const [paused, setPaused] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const done = step >= total;

  useEffect(() => {
    if (started) return;
    const timer = window.setTimeout(() => setStarted(true), 800);
    return () => window.clearTimeout(timer);
  }, [started]);

  useEffect(() => {
    if (!started || paused || done) return;
    const text = DEMO.turns[step].text;
    if (chars < text.length) {
      const timer = window.setTimeout(() => setChars((count) => Math.min(text.length, count + 2)), 24);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setStep((value) => value + 1);
      setChars(0);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [started, paused, done, step, chars]);

  useEffect(() => {
    const element = bodyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [step, chars]);

  const replay = () => {
    setStep(0);
    setChars(0);
    setPaused(false);
    setStarted(true);
  };

  const speaking = !done && started ? DEMO.turns[step].speaker : null;

  return (
    <figure className="demo" aria-label="Example council debate">
      <div className="demo-bar">
        <span className="demo-faces" aria-hidden="true">
          {FALLBACK_PERSONAS.map((persona) => (
            <Portrait key={persona.name} name={persona.name} talking={speaking === persona.name} />
          ))}
        </span>
        <span className="demo-mode">{DEMO.mode}</span>
        {done ? (
          <button type="button" className="demo-control" onClick={replay}>
            Replay
          </button>
        ) : (
          <button type="button" className="demo-control" onClick={() => setPaused((value) => !value)}>
            {paused ? "Play" : "Pause"}
          </button>
        )}
      </div>

      <div className="demo-body" ref={bodyRef}>
        <article className="turn turn-user">
          <p>{DEMO.question}</p>
        </article>
        {DEMO.turns.slice(0, done ? total : step + (started ? 1 : 0)).map((turn, index) => {
          const current = index === step && !done;
          const text = current ? turn.text.slice(0, chars) : turn.text;
          return (
            <article
              key={turn.speaker}
              className="turn"
              style={personaStyle(turn.speaker)}
              data-streaming={current}
            >
              <span className="turn-face" aria-hidden="true">
                <Portrait name={turn.speaker} talking={current} />
              </span>
              <div className="turn-body">
                <header>
                  <strong>{turn.speaker}</strong>
                </header>
                <p>{text || <span className="thinking">thinking</span>}</p>
              </div>
            </article>
          );
        })}
      </div>

      <div className="demo-composer" aria-hidden="true">
        <span className="speaker-chip is-on">
          Everyone
        </span>
        <span className="demo-input">Ask the whole council...</span>
      </div>
      <figcaption className="sr-only">
        {DEMO.question} {DEMO.turns.map((turn) => `${turn.speaker}: ${turn.text}`).join(" ")}
      </figcaption>
    </figure>
  );
}

// In-page links scroll without touching the URL hash, which the app uses for routing.
const scrollToSection = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
};

export default function Home({ onStart, isSignedIn }: { onStart: () => void; isSignedIn: boolean }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState("Shark Tank");
  const startLabel = isSignedIn ? "Open your councils" : "Start a council";

  return (
    <div className="home">
      <nav className="home-nav" aria-label="Main">
        <a className="brand-lockup" href="#" aria-label="Think Tank home">
          <LogoMark size={32} title="" />
          <p>Think Tank</p>
        </a>
        <div className="home-links">
          <a href="#cast" onClick={(event) => scrollToSection(event, "cast")}>
            The council
          </a>
          <a href="#how" onClick={(event) => scrollToSection(event, "how")}>
            How it works
          </a>
        </div>
        <button type="button" className="btn-primary btn-small" onClick={onStart}>
          {startLabel}
        </button>
      </nav>

      <header className="home-hero">
        <div className="hero-copy">
          <h1 className="hero-title">Never think alone again.</h1>
          <p className="hero-sub">
            Think Tank puts five AI minds with opposite instincts in a room with your idea. One attacks
            it, one inflates it, one plans it, one prices it, and one keeps everyone honest. You leave
            with the argument, not just an answer.
          </p>
          <div className="hero-cta">
            <button type="button" className="btn-primary" onClick={onStart}>
              {startLabel}
            </button>
            <a className="btn-secondary" href="#cast" onClick={(event) => scrollToSection(event, "cast")}>
              Meet the council
            </a>
          </div>
        </div>
        <CouncilDemo />
      </header>

      <section className="home-section" id="cast" aria-labelledby="cast-title">
        <div className="section-head">
          <h2 id="cast-title">Five minds, five blind spots</h2>
          <p>Each one is tuned to catch what the others miss. Seat all five, or only the ones you need.</p>
        </div>
        <ul className="cast">
          {FALLBACK_PERSONAS.map((persona) => {
            const meta = PERSONA_META[persona.name];
            return (
              <li
                key={persona.name}
                className="cast-card"
                style={personaStyle(persona.name)}
                onMouseEnter={() => setHovered(persona.name)}
                onMouseLeave={() => setHovered(null)}
              >
                <Portrait name={persona.name} talking={hovered === persona.name} className="cast-portrait" />
                <h3>{persona.name}</h3>
                <p className="cast-archetype">{meta?.archetype ?? persona.role}</p>
                <blockquote>{meta?.quote ?? persona.tagline}</blockquote>
                <p className="cast-catches">
                  <span>Catches</span> {persona.focus.toLowerCase()}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="home-section" id="how" aria-labelledby="how-title">
        <div className="section-head">
          <h2 id="how-title">From idea to argument in three moves</h2>
        </div>
        <ol className="steps">
          <li>
            <span className="step-no">1</span>
            <h3>Seat your council</h3>
            <p>Everyone is in by default. Send out anyone you don't need today.</p>
            <div className="step-visual step-faces" aria-hidden="true">
              {FALLBACK_PERSONAS.map((persona, index) => (
                <Portrait key={persona.name} name={persona.name} className={index === 3 ? "is-out" : ""} />
              ))}
            </div>
          </li>
          <li>
            <span className="step-no">2</span>
            <h3>Set the pressure</h3>
            <p>Turn the heat up or down. Four levels change how every mind behaves, from open floor to trial by fire.</p>
            <div className="step-visual">
              <PressureControl variant="panel" mode={demoMode} onChange={setDemoMode} />
            </div>
          </li>
          <li>
            <span className="step-no">3</span>
            <h3>Ask once, hear five takes</h3>
            <p>Each mind answers in turn and reacts to the ones before it. Export the debate when it lands.</p>
            <div className="step-visual step-chips" aria-hidden="true">
              <span className="speaker-chip is-on">
                Everyone
              </span>
              {FALLBACK_PERSONAS.slice(0, 3).map((persona) => (
                <span key={persona.name} className="speaker-chip" style={personaStyle(persona.name)}>
                  {persona.name}
                </span>
              ))}
            </div>
          </li>
        </ol>
      </section>

      <section className="home-final" aria-labelledby="final-title">
        <div className="final-faces" aria-hidden="true">
          {FALLBACK_PERSONAS.map((persona) => (
            <Portrait key={persona.name} name={persona.name} />
          ))}
        </div>
        <h2 id="final-title">Bring the idea you're not sure about.</h2>
        <button type="button" className="btn-primary" onClick={onStart}>
          {startLabel}
        </button>
      </section>

      <footer className="home-footer">
        <span>Think Tank</span>
        <span>A council for founders, students and overthinkers.</span>
      </footer>
    </div>
  );
}
