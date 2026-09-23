const E = require('../src/engine.js');

const samples = [
`Ok so today was genuinely one of the best days in a long time. Woke up late, made chai, sat on the balcony while it rained. Amma called and we spoke for an hour about nothing. Then I finished the deck I'd been avoiding for a week and my manager actually said it was the cleanest work she's seen from me. I felt light. I smiled at strangers on the road. I want to keep this feeling in my pocket.`,

`Rohit and I talked for two hours and at the end he said he's moving to Bangalore in March. I said congratulations and I meant it, I do mean it, but I came home and cried in the bathroom with the tap running so nobody would hear. I always knew this would happen. I keep replaying the part where he said "you'll visit, right?". I don't know if I'll survive another goodbye like this. My chest is heavy and I can't sleep.`,

`I want 3 matching blazer suits for the trio — me, Sana and Dhruv — plus coordinated outfits for our partners, so that at Sana's wedding we look like a film poster. Emerald green for the women, charcoal for the men. I have been saving up for this for four months and I still need about 40k. Also want a good camera before the wedding so I can shoot the haldi myself.`,

`Work is crushing me. 11 hours at the desk, skipped lunch, two clients shouting, my back is killing me and I snapped at the intern for no reason which I feel terrible about. I came home, ordered food I didn't even want, scrolled for two hours. I'm so tired of being tired. I keep telling myself this is temporary but it has been eight months.`,

`Quiet day. Wrote three pages in the journal, no plans, made dal and rice, watched the light change on the terrace. I've been thinking about starting a small ceramics course in October — nothing serious, just something for my hands. Grateful for days like this, honestly.`,

`- Kindle Paperwhite
- black linen kurta set for the wedding
- running shoes
- savings for the Leh trip in June`,
];

for (const s of samples) {
  const a = E.analyze(s);
  console.log('══════════════════════════════════════');
  console.log('WORDS:', a.words, '| CONFIDENCE:', a.confidence + '%', '| VAL:', a.valence, 'ENERGY:', a.energy, 'CLARITY:', a.clarity);
  console.log('EMOTIONS:', a.emotions.top.map(t => `${t.label} ${t.pct}%`).join(', '));
  console.log('PHYSICAL:', a.phys.map(p => p.label).join(', ') || '—');
  console.log('MENTAL:', a.mind.map(m => m.label).join(', ') || '—');
  console.log('THEMES:', a.themes.map(t => t.label).join(', ') || '—');
  console.log('PRIMARY:', a.primary.name, '(score', a.primary.score + ')');
  console.log('CROSS:', a.crossLinks.map(c => c.name).join(' | ') || '—');
  console.log('REASON:', a.reason);
  console.log('TITLES:', a.titles.map(t => `"${t.text}"`).join('  ·  '));
  console.log('LOGLINE:', a.logline);
  console.log('HIGHLIGHT:', a.highlight);
  console.log('PHASE:', a.phase.label);
  if (a.wish.detected) console.log('WISH ITEMS:', a.wish.items.map(i => i.text).join(' + '));
}
