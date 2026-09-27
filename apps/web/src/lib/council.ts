import type { CSSProperties } from "react";
import type { Persona } from "./types";

// Shared council data used by the home page and the app.

export const MODES = [
  {
    name: "Brainstorm",
    description: "A wide-open idea forge. The council expands, mutates, remixes, and finds unexpected paths.",
    intent: "Use when you need volume, novelty, naming, positioning, or a bigger frame.",
    ritual: "Open loops, high imagination, low judgement."
  },
  {
    name: "Shark Tank",
    description: "A pressure chamber for business logic. The council interrogates market, moat, user pain, and proof.",
    intent: "Use before pitching, pricing, fundraising, or deciding if an idea deserves oxygen.",
    ritual: "Defend the weak spots or cut them."
  },
  {
    name: "Devils Court",
    description: "A hostile audit where every persona hunts contradictions, failure modes, and hidden costs.",
    intent: "Use when you are attached to an idea and need the room to be intellectually honest.",
    ritual: "No politeness tax. Only useful pressure."
  },
  {
    name: "Co-Founder",
    description: "A focused build session with strategic disagreement, practical next steps, and founder-level synthesis.",
    intent: "Use when you already care about the idea and need a path from thought to execution.",
    ritual: "Ship the next clean decision."
  }
];

export const FALLBACK_PERSONAS: Persona[] = [
  {
    name: "Devil",
    role: "Adversary",
    tagline: "Relentless stress test.",
    focus: "Assumptions, contradictions, failure modes."
  },
  {
    name: "Tyson",
    role: "Visionary",
    tagline: "Pushes bold futures.",
    focus: "Scale, virality, imagination, upside."
  },
  {
    name: "Bison",
    role: "Operator",
    tagline: "Reality check and execution.",
    focus: "Feasibility, scope, timeline, constraints."
  },
  {
    name: "Anshu",
    role: "Strategist",
    tagline: "Founder-level wisdom.",
    focus: "Strategy, leadership, human factors."
  },
  {
    name: "Bucks",
    role: "Monetizer",
    tagline: "Revenue and growth leverage.",
    focus: "Pricing, distribution, monetization loops."
  }
];

export const PERSONA_META: Record<
  string,
  {
    archetype: string;
    species: string;
    signal: string;
    stat: string;
    quote: string;
  }
> = {
  Devil: {
    archetype: "The Ruin Tester",
    species: "Horned devil advocate",
    signal: "Find the contradiction before the market does.",
    stat: "Brutality 96",
    quote: "If it survives me, it might survive reality."
  },
  Tyson: {
    archetype: "The Cultural Igniter",
    species: "Tiger in a hoodie",
    signal: "Make the idea louder, stranger, and more contagious.",
    stat: "Momentum 91",
    quote: "Small ideas are just big ideas wearing fear."
  },
  Bison: {
    archetype: "The Ground Commander",
    species: "Minotaur baller",
    signal: "Turn the fantasy into a sequence people can execute.",
    stat: "Feasibility 94",
    quote: "Show me the path, the cost, and the first version."
  },
  Bucks: {
    archetype: "The Money Gremlin",
    species: "Blinged-out monkey",
    signal: "Spot loops, margins, premium behavior, and hidden leverage.",
    stat: "Upside 89",
    quote: "If value moves, money can move with it."
  },
  Anshu: {
    archetype: "The Calm Apex",
    species: "Saint fox",
    signal: "Balance ambition with timing, people, and judgment.",
    stat: "Wisdom 98",
    quote: "A good decision makes the founder lighter."
  }
};

// The only hues in the interface. Chrome stays blue and white; color means "a mind".
export const PERSONA_COLORS: Record<string, string> = {
  Devil: "#ff5a5f",
  Tyson: "#ff9b3d",
  Bison: "#d9a36a",
  Anshu: "#6fe3c1",
  Bucks: "#f7d046"
};

export const personaStyle = (name: string) =>
  ({ "--persona": PERSONA_COLORS[name] ?? "#eceaff" }) as CSSProperties;

export const STARTER_PROMPTS: Record<string, string[]> = {
  Brainstorm: [
    "Give me ten names for a study app that feels like a co-op game.",
    "What would this idea look like if it had to go viral in a week?"
  ],
  "Shark Tank": [
    "I charge $12/month for a habit tracker with no free tier. Why would anyone pay?",
    "Who pays for this first, and what do they stop paying for instead?"
  ],
  "Devils Court": [
    "Here's my plan. Find the assumption that kills it.",
    "What happens when a bigger company copies this in a month?"
  ],
  "Co-Founder": [
    "I have two weekends. What's the smallest version worth shipping?",
    "Turn this idea into the first five tasks for Monday."
  ]
};
