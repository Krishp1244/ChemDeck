# ChemDeck

A flashcard study app built for organic chemistry — draw structures directly on your cards, organize them into sets, and sync everything across devices.

**Live app:** https://krishp1244.github.io/ChemDeck/

## Features

- Flip-card flashcards with front/back text
- Freehand drawing on any card (pen, highlighter, eraser, pressure-sensitive with a stylus)
- A separate scratchpad for working out problems
- Organize cards into named sets (decks)
- Google sign-in with cross-device cloud sync
- Responsive layout for desktop, tablet, and mobile

## Tech stack

- Vanilla HTML, CSS, and JavaScript — no framework, no build step
- Firebase Authentication (Google sign-in)
- Cloud Firestore for storage, secured with per-user Firestore rules
- HTML5 Canvas for the drawing and scratchpad features
- Hosted on GitHub Pages

## Running locally

This is a static site, so there's no build step.

```bash
git clone https://github.com/Krishp1244/ChemDeck.git
cd ChemDeck
python -m http.server 8080
```

Then open `http://localhost:8080`. Sign-in and sync require your own Firebase project — update the `firebaseConfig` object in `script.js` and deploy `firestore.rules` to it.

## Feedback

Found a bug or have a feature idea? [Send feedback](https://docs.google.com/forms/d/e/1FAIpQLScUP8M6NQgWFrLJnILMcgqaDOjJzO_IBMbGm-C5LzXB8sd2Ug/viewform?usp=dialog) — also linked directly in the app.
