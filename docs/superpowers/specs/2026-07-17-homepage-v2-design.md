# EduNex Homepage V2 Design

## Scope

Create a new, standalone public homepage at `/homepage-v2`. The existing homepage and its styling remain unchanged. This is a production-ready React route for desktop and mobile, built within the existing Vite, React, Tailwind, and Framer Motion stack.

## Purpose

Homepage V2 introduces EduNex as the complete operating system for schools: it supports leadership, administration, teachers, reception, parents, and students in one calm, connected environment. Its job is to build trust with decision-makers and lead them to request a demo.

## Primary action

- Primary: **Request a demo**
- Secondary: **Sign in** for existing customers

## Design direction: Campus Command

The page should feel like the quiet command center of a well-run modern school at the end of a focused day: composed, capable, and reassuring.

Use a controlled deep eucalyptus/near-black hero, neutral-white content surfaces, and a single lime signal for meaningful emphasis. The visual language should be precise and architectural, with generous editorial space and a realistic, carefully structured product composition. It must not borrow the existing claymorphic visual language.

Avoid generic AI dashboards, blue or purple gradients, neon, bloom effects, glass panels, decorative grids, fake giant metrics, dense legacy administration UIs, and playful school-portal imagery.

## Information architecture

1. **Hero** — clear statement of EduNex's role as the operating system for every school day; request-demo CTA; sign-in link; a refined product scene that implies live operations without inventing unsupported data.
2. **Operating clarity** — explain the platform's value for school leadership and operations through an integrated, asymmetric composition rather than a repeated feature-card grid.
3. **One connected system** — show how principals, teachers, reception, parents, and students have role-appropriate touchpoints while sharing a reliable school-wide foundation.
4. **Practical intelligence** — introduce forthcoming AI workflows: timetable generation, daily planning, report and document creation, and communications. AI is framed as time returned to people, not as spectacle.
5. **Proof and reassurance** — use only factual, approved evidence. Until real customer names or testimonials are supplied, use capability and operational proof rather than invented school names, portraits, or quotes.
6. **Final conversion** — concise invitation to request a demo, with a predictable route to existing-customer sign-in.

## Interaction and states

- Navigation is responsive: full navigation on desktop, accessible disclosure menu on small screens.
- The request-demo action may initially open an intentional contact path or a clearly marked placeholder destination only if no real demo workflow exists; it must not appear functional when it is not.
- Product visuals are illustrative and clearly labeled when needed; no fabricated live metrics.
- Motion communicates hierarchy and state only: restrained entrance and hover feedback, with complete `prefers-reduced-motion` fallbacks.
- All actions have visible keyboard focus, meaningful labels, and touch-friendly targets.

## Content rules

- Use confident, plain language. Do not use generic claims such as “the future of education” or “AI-powered everything.”
- Refer to AI as concrete operations support.
- Preserve the reality that EduNex serves the full school ecosystem, not only teachers.
- Do not invent testimonials, customer logos, or performance results.

## Technical boundaries

- New route and page component only; do not modify the current homepage's route, component, or styles.
- Reuse the project’s React, Tailwind, Framer Motion, and Lucide foundations where appropriate.
- Create locally scoped V2 styles/components to prevent visual leakage into the existing site.
- Meet the project baseline of WCAG 2.2 AA: contrast, keyboard navigation, focus visibility, semantic landmarks, and reduced motion.

## Validation

- Build passes with the existing project command.
- Verify `/homepage-v2` at mobile, tablet, and desktop widths.
- Confirm current homepage remains visually and behaviorally unchanged.
- Check buttons, keyboard focus, navigation, and reduced-motion behavior.
