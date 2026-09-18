---
name: LeaveApp
description: HHMB internal leave management — dark operational UI
colors:
  primary: "#6366F1"
  primary-focus: "#4F46E5"
  primary-light: "#818CF8"
  secondary: "#10B981"
  accent: "#F59E0B"
  danger: "#EF4444"
  success: "#059669"
  background: "#0F172A"
  surface: "#1E293B"
  surface-light: "#334155"
  surface-lighter: "#475569"
  text-primary: "#F8FAFC"
  text-secondary: "#CBD5E1"
  text-muted: "#94A3B8"
  border: "#475569"
  card-bg: "#1E293B"
  input-bg: "#334155"
typography:
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  heading:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.3
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
rounded:
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.5rem"
  xl: "0.75rem"
spacing:
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-focus}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.875rem"
  card:
    backgroundColor: "{colors.card-bg}"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.input-bg}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
---

# Design System

## Overview

LeaveApp is a dark, operational B2B leave tool for Harrisons Holdings (Malaysia) Berhad. Surfaces prioritize scanability and role-scoped tasks over marketing expression. Brand shows up in the Harrisons mark, indigo primary actions, and quiet slate chrome — not neon decoration or dashboard-card stacks.

## Colors

- **Canvas:** `background` (#0F172A) page; `surface` / `card-bg` (#1E293B) panels; `surface-light` (#334155) inputs and hover.
- **Text:** `text-primary` for values and titles; `text-secondary` for supporting lines; `text-muted` for labels and meta.
- **Action:** `primary` / `primary-focus` for commit actions and active nav.
- **Status:** `success`, `danger`, `accent` for leave states and alerts — use sparingly, never as page chrome.

## Typography

Inter (system fallbacks) throughout. Page titles ~`text-2xl` bold; section labels uppercase `text-xs` muted; field labels muted; values `text-sm` primary. Prefer denser HRIS-style definition lists over airy marketing type.

## Layout

App shell: fixed left sidebar + scrollable main. Content pages use a single primary column (often `max-w-4xl`), page header with title + actions, then one structured panel rather than competing card grids. Profile and settings: identity strip, then grouped Contact / Job fields in label–value rows (two columns for job meta on desktop).

## Elevation & Depth

Flat dark surfaces with 1px `border` hairlines. Prefer borders over heavy shadows; `elegant` / `elegant-lg` sparingly on modals. Avoid glow accents on routine operate surfaces.

## Shapes

`rounded-md` / `rounded-lg` for cards, inputs, and buttons. Square-ish initials avatars over large circular hero avatars. Soften, don’t pill, status text on operate pages.

## Components

- **Primary button:** indigo fill, white text.
- **Secondary button:** transparent/surface with `border` outline.
- **Cards/panels:** `card-bg` + `border`, single panel preferred for related data.
- **Forms:** inputs only when editing; read-only data as definition rows, not fake inputs.
- **Nav:** indigo highlight for active route; icons + labels.

## Do's and Don'ts

**Do**

- Keep Profile and settings operational and dense enough for office use.
- Reuse existing Tailwind tokens (`primary`, `surface`, `text-*`, `border`).
- Preserve role-scoped editability and HSSB terminology (employee no., branch, pay group).

**Don't**

- Stack decorative cards, purple glow, emoji callouts, or neon status pills for routine data.
- Invent a second light theme or new font family without an explicit redesign.
- Turn Profile into a full HRIS people dossier (payroll, biodata, org chart).
