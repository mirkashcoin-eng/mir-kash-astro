// Auto-generated from the Mir Kash blog doc. Body HTML lives in ./bodies/<slug>.html.
// To swap a post's image later, set `image: '/journal/<file>'` on its entry below.
export type JournalCategory = 'Materials' | 'Styling' | 'Behind Mir Kash' | 'Culture';
export const CATEGORIES: JournalCategory[] = ['Materials', 'Styling', 'Behind Mir Kash', 'Culture'];

export interface JournalPost {
  slug: string;
  title: string;
  category: JournalCategory;
  excerpt: string;
  readMin: number;
  date: string;          // ISO, used for ordering + display
  imageMatch: string;    // keyword matched against Shopify products for the thumbnail
  role: '' | 'cover' | 'feature';
  image?: string;        // optional manual override; wins over the Shopify match
  body: string;          // article HTML
}

const bodies = import.meta.glob('./bodies/*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const META: Omit<JournalPost, 'body'>[] = [
  {
    "slug": "behind-the-braidey-bag-founder-edition",
    "title": "Behind the Braidey Bag: Founder Edition",
    "category": "Behind Mir Kash",
    "excerpt": "Every season, one design rises beyond being just a product — it becomes a conversation. For Mir Kash, that bag is Braidey. I’ve watched her carried from…",
    "readMin": 3,
    "date": "2026-07-20",
    "imageMatch": "braidey",
    "role": "feature"
  },
  {
    "slug": "why-luxury-brands-avoid-vegan-handbags",
    "title": "Why Do Luxury Brands Still Avoid Vegan Handbags?",
    "category": "Culture",
    "excerpt": "For decades, luxury fashion has been built on the prestige of animal leather. From buttery calfskin to exotic hides, heritage houses have tied their…",
    "readMin": 4,
    "date": "2026-07-06",
    "imageMatch": "charlotte",
    "role": "cover"
  },
  {
    "slug": "can-apples-become-leather",
    "title": "Can Apples Become Leather?",
    "category": "Materials",
    "excerpt": "At Mir Kash, we use apple leather extensively in our designs — along with other innovative forms of vegan…",
    "readMin": 3,
    "date": "2026-06-22",
    "imageMatch": "tan",
    "role": ""
  },
  {
    "slug": "did-labubu-just-ghost-us",
    "title": "Wait… Did Labubu Just Ghost Us? The Fall of the “It-Bag” Sidekick",
    "category": "Culture",
    "excerpt": "Remember when Labubu was everywhere? Dangling from totes, clinging to crossbodies, photobombing clutches like it owned the moment. For one hot season,…",
    "readMin": 2,
    "date": "2026-06-10",
    "imageMatch": "",
    "role": ""
  },
  {
    "slug": "how-to-match-your-handbag-with-your-outfit",
    "title": "How to Match Your Handbag with Your Outfit—The Ultimate Styling Guide",
    "category": "Styling",
    "excerpt": "Fashion is all about balance—and no outfit feels complete without the right handbag. Whether it’s a casual brunch look or an elegant evening out, the bag…",
    "readMin": 4,
    "date": "2026-05-28",
    "imageMatch": "braidey",
    "role": ""
  },
  {
    "slug": "introducing-kelly",
    "title": "Introducing Kelly",
    "category": "Behind Mir Kash",
    "excerpt": "There were some common problems that we saw in the market with party…",
    "readMin": 1,
    "date": "2026-05-14",
    "imageMatch": "kelly",
    "role": ""
  },
  {
    "slug": "vegan-materials-beyond-the-leather-feel",
    "title": "Vegan Materials beyond the ‘Leather Feel’",
    "category": "Materials",
    "excerpt": "When most people think of vegan handbags, the first things that come to mind are plant-based leathers like cactus, apple, or mushroom, or synthetic PU…",
    "readMin": 2,
    "date": "2026-04-30",
    "imageMatch": "",
    "role": ""
  },
  {
    "slug": "how-can-your-bag-make-a-statement",
    "title": "How Can Your Bag Make a Statement?",
    "category": "Styling",
    "excerpt": "Choosing the right bag can be a game-changer for your look and we’ve highlighted a few ways…",
    "readMin": 3,
    "date": "2026-04-16",
    "imageMatch": "",
    "role": ""
  },
  {
    "slug": "looks-we-love-with-the-foxy",
    "title": "Looks we love with the Foxy",
    "category": "Styling",
    "excerpt": "…",
    "readMin": 1,
    "date": "2026-04-02",
    "imageMatch": "foxy",
    "role": ""
  },
  {
    "slug": "7-tips-to-maintain-your-handbags",
    "title": "7 Tips to Maintain Your Handbags",
    "category": "Styling",
    "excerpt": "We tend to hang our bags on hooks and doorknobs. However, that’s one of the main reasons your bag’s handles damage and distort the body. The best way to…",
    "readMin": 2,
    "date": "2026-03-19",
    "imageMatch": "",
    "role": ""
  },
  {
    "slug": "inside-their-handbags-everyday-essentials",
    "title": "Inside Their Handbags: The Everyday Essentials (and the Surprising Extras)",
    "category": "Behind Mir Kash",
    "excerpt": "At Mir Kash, we’re endlessly curious about the secret lives of handbags. So we didn’t just wonder—we asked. We sat down with women in a series of…",
    "readMin": 2,
    "date": "2026-03-05",
    "imageMatch": "",
    "role": ""
  },
  {
    "slug": "valentines-day-gift-guide",
    "title": "Valentine's Day Gift Guide ♥︎",
    "category": "Styling",
    "excerpt": "It’s only fair to gift your girl something different & special as she is this Valentine’s…",
    "readMin": 1,
    "date": "2026-02-10",
    "imageMatch": "",
    "role": ""
  },
  {
    "slug": "crafting-conscious-wardrobes",
    "title": "Crafting Conscious Wardrobes: Mir Kash's Guide to Sustainable Fashion",
    "category": "Culture",
    "excerpt": "In a world where fashion choices echo louder than ever, Mir Kash takes the lead in redefining wardrobes with a conscious touch. Explore the art of…",
    "readMin": 2,
    "date": "2026-01-22",
    "imageMatch": "",
    "role": ""
  },
  {
    "slug": "the-importance-of-vegan-leather",
    "title": "The Importance of Vegan Leather in Redefining Elegance",
    "category": "Culture",
    "excerpt": "In the ever-evolving landscape of fashion, Mir Kash stands as a beacon of change, championing the use of vegan leather to redefine elegance. Beyond the…",
    "readMin": 2,
    "date": "2026-01-08",
    "imageMatch": "",
    "role": ""
  },
  {
    "slug": "starting-a-vegan-brand",
    "title": "Top 3 Tips When Starting a Vegan Brand",
    "category": "Behind Mir Kash",
    "excerpt": "Starting a vegan brand isn’t just about swapping animal leather for an alternative. It’s about creating a business that blends style, ethics, and…",
    "readMin": 3,
    "date": "2025-12-15",
    "imageMatch": "",
    "role": ""
  }
];

export const POSTS: JournalPost[] = META.map((m) => ({
  ...m,
  body: bodies[`./bodies/${m.slug}.html`] ?? '',
})) as JournalPost[];

export function getPost(slug: string): JournalPost | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export function relatedPosts(slug: string, n = 3): JournalPost[] {
  const p = getPost(slug);
  if (!p) return POSTS.slice(0, n);
  const same = POSTS.filter((x) => x.slug !== slug && x.category === p.category);
  const rest = POSTS.filter((x) => x.slug !== slug && x.category !== p.category);
  return [...same, ...rest].slice(0, n);
}

export function formatJournalDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
