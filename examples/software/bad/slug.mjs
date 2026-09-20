// Deliberate regression: punctuation is retained and repeated spaces are not collapsed.
export function slug(text) {return text.trim().toLowerCase().replace(' ','-');}
