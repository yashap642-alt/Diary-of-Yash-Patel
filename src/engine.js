/* ============================================================================
   REEL — diary intelligence engine
   Offline, deterministic, dependency-free. Pure logic, no DOM.
   Given one raw thought-dump it returns: emotions, physical & mental state,
   themes, life-chapter shelves (with primary + cross-links), short-story
   titles, a cinematic summary, a highlight line, and — when the entry is a
   wish — a clean to-the-point list of tangible items.
   ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ReelEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ utils */

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function hash(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rnd(seed) { // deterministic 0..1 from seed
    var x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }
  function pick(arr, seed) { return arr[Math.floor(rnd(seed) * arr.length) % arr.length]; }
  function sentences(text) {
    return String(text || '')
      .split(/(?:[.!?…]+["')\]]?\s+|\n+)/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 1; });
  }
  function words(text) {
    var m = String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9'’\-]*/g);
    return m || [];
  }
  function pluralOk(word, s) {
    if (word === s) return true;
    if (s === word + 's' || s + 'es' === word) return true;
    if (word === s + 'es' || word === s + 's') return true;
    return false;
  }

  /* -------------------------------------------------------------- lexicons */

  var EMO = {
    joy: {
      label: 'Joy', color: '#E0A94A',
      mild: ['happy', 'glad', 'cheerful', 'content', 'pleased', 'lovely', 'nice day', 'laughed', 'laughing', 'laugh', 'smiled', 'smiling', 'smile', 'fun', 'enjoyed', 'enjoying', 'enjoy', 'sunshine', 'sweet', 'cute', 'pretty', 'upbeat', 'lively', 'bright', 'good news', 'happy place', 'made me laugh', 'dancing', 'danced', 'silly', 'songs', 'playful', 'weekend', 'party'],
      strong: ['joy', 'joyful', 'delighted', 'thrilled', 'ecstatic', 'excited', 'i got the', 'best news', 'amazing', 'fantastic', 'wonderful', 'brilliant', 'celebrated', 'celebration', 'celebrate', 'best day', 'incredible', 'glowing', 'beam*', 'over the moon', 'couldn\'t stop smiling', 'most fun', 'pure joy']
    },
    love: {
      label: 'Love', color: '#D9737C',
      mild: ['love', 'loved', 'loving', 'adore', 'fond', 'my crush', 'has a crush', 'dear', 'affection', 'cuddle', 'cuddled', 'hug', 'hugged', 'holding hands', 'held my hand', 'kiss', 'kissed', 'care', 'cared for', 'she said yes', 'he said yes', 'married', 'marriage', 'wedding', 'anniversary', 'valentine', 'together'],
      strong: ['in love', 'soulmate', 'devoted', 'love of my life', 'fiance', 'fiancee', 'fiancé', 'fiancée', 'my person', 'deeply in love', 'love him', 'love her', 'love them']
    },
    gratitude: {
      label: 'Gratitude', color: '#C9A66B',
      mild: ['grateful', 'gratitude', 'thankful', 'thanks', 'thank you', 'appreciate', 'appreciated', 'blessed', 'lucky', 'fortunate', 'means a lot', 'kindness', 'kind of them', 'so kind'],
      strong: ['deeply grateful', 'so thankful', 'truly blessed', 'heart full', 'heart is full', 'owe them', 'indebted']
    },
    pride: {
      label: 'Pride', color: '#8E7CC3',
      mild: ['proud', 'achievement', 'achieved', 'accomplished', 'managed to', 'progress', 'milestone', 'did it', 'nailed it', 'stronger', 'capable', 'better than yesterday', 'small win', 'kept going'],
      strong: ['so proud', 'proudest', 'breakthrough', 'first time ever', 'proved', 'promoted', 'graduated', 'cleared', 'passed the', 'won', 'winning', 'got the offer', 'got the job', 'selected', 'got it', 'i got it', 'finally got', 'chose me', 'picked me', 'signed the']
    },
    hope: {
      label: 'Hope', color: '#7FA88C',
      mild: ['hope', 'hopeful', 'optimistic', 'brighter', 'better days', 'new start', 'fresh start', 'start over', 'plan to', 'planning to', 'planning', 'looking forward', 'possibility', 'possibilities', 'chance', 'apply', 'applied', 'try again', 'next time', 'turning point', 'finally decided'],
      strong: ['i will', 'i\'m going to', 'this time it\'s different', 'believing in', 'faith in', 'determined', 'committed to', 'never giving up']
    },
    calm: {
      label: 'Calm', color: '#7FA0B0',
      mild: ['calm', 'quiet', 'peaceful', 'gentle', 'slow', 'still', 'serene', 'relaxed', 'relaxing', 'breathe', 'breathing', 'soft', 'unhurried', 'no rush', 'steady', 'grounded', 'settled', 'comfort', 'easy', 'warm tea', 'light rain', 'rain', 'rains', 'raining', 'sound of rain', 'nothing to do', 'nothing much', 'long bath'],
      strong: ['peace', 'at peace', 'serenity', 'meditat*', 'quiet mind', 'deep breath', 'contentment', 'bliss', 'tranquil', 'weight off', 'let it be', 'accepted it']
    },
    sadness: {
      label: 'Sadness', color: '#6B7F9E',
      mild: ['sad', 'down', 'blue', 'unhappy', 'tears', 'tear', 'cry', 'cried', 'crying', 'hurt', 'hurting', 'ache', 'aching', 'upset', 'disappointed', 'disappointment', 'gloomy', 'heavy heart', 'sighed', 'sigh', 'weep*', 'low', 'painful', 'pain', 'feel nothing', 'nothing at all', 'just flat', 'feeling flat'],
      strong: ['heartbreak', 'heartbroken', 'broken heart', 'devastated', 'shattered', 'grief', 'grieving', 'grieve', 'depressed', 'depression', 'despair', 'hopeless', 'miserable', 'unbearable', 'hollow', 'numb', 'empty inside', 'fell apart', 'broke down', 'sobbing', 'sobbed', 'broken']
    },
    longing: {
      label: 'Longing', color: '#A98BA0',
      mild: ['unfinished', 'unfinished thought', 'leaving', 'leave this city', 'another life', 'if only', 'wish he', 'wish she', 'wish i', 'someday', 'one day i', 'dream of', 'dreaming of', 'longing', 'long for', 'yearn*', 'wanted to but', 'should have', 'what could have been', 'maybe one day', 'back then', 'used to be', 'used to', 'someday i', 'still think about', 'can\'t stop thinking about'],
      strong: ['aching for', 'desperately want', 'crave', 'craving', 'dream about', 'miss him so', 'miss her so', 'not a day goes by', 'i\'d give anything']
    },
    loneliness: {
      label: 'Loneliness', color: '#7E7B8F',
      mild: ['alone', 'lonely', 'on my own', 'no one', 'nobody', 'isolated', 'by myself', 'left out', 'unwanted', 'invisible', 'no friends', 'no one to talk', 'silence at home'],
      strong: ['utterly alone', 'so lonely', 'completely alone', 'abandoned', 'no one left', 'not a single soul', 'nobody cares']
    },
    anxiety: {
      label: 'Anxiety', color: '#A97C50',
      mild: ['nervous', 'worried', 'worry', 'worrying', 'uneasy', 'restless', 'tense', 'tension', 'stress', 'stressed', 'overthinking', 'overthink', 'spiral*', 'doubt', 'doubts', 'doubtful', 'insecure', 'insecurity', 'afraid', 'scared', 'fear', 'fearful', 'jittery', 'butterflies', 'racing thoughts', 'what if', 'second guessing', 'uneasy'],
      strong: ['panic', 'panicking', 'panicked', 'terrified', 'terrifying', 'dread', 'dreading', 'anxiety', 'anxious', 'meltdown', 'can\'t breathe', 'overwhelmed', 'overwhelming', 'insomnia', 'sleepless', 'frozen', 'shaking', 'can\'t sleep', 'cannot sleep', 'wide awake', 'chest is tight', 'chest tight', 'rehearsing', 'rehearsed']
    },
    anger: {
      label: 'Anger', color: '#C0603F',
      mild: ['annoyed', 'annoying', 'irritated', 'irritating', 'frustrated', 'frustrating', 'frustration', 'mad at', 'bothered', 'fed up', 'sick of', 'tired of', 'unfair', 'argued', 'argument', 'shouting', 'yelled', 'yelling', 'snapped at', 'disrespected', 'disrespectful', 'sarcastic'],
      strong: ['angry', 'anger', 'furious', 'rage', 'fuming', 'hate', 'hated', 'betrayed', 'betrayal', 'resent*', 'livid', 'boiling', 'enraged', 'disgusted', 'screamed', 'slammed', 'walked out', 'broke my trust']
    },
    shame: {
      label: 'Shame', color: '#9A7B6A',
      mild: ['guilty', 'guilt', 'ashamed', 'shame', 'embarrass*', 'cringe', 'awkward', 'my fault', 'let down', 'let them down', 'disappointed in myself', 'shouldn\'t have', 'should have tried harder', 'failed myself', 'not enough', 'inadequate'],
      strong: ['worthless', 'failure', 'a failure', 'pathetic', 'useless', 'humiliated', 'humiliation', 'hate myself', 'can\'t forgive myself', 'everyone was right']
    },
    exhaustion: {
      label: 'Exhaustion', color: '#8A8778',
      mild: ['tired', 'tiring', 'weary', 'drained', 'crushing', 'crushed', 'exhausting', 'sleepy', 'long day', 'busy day', 'worn out', 'no energy', 'low energy', 'sluggish', 'can\'t focus', 'barely', 'dragging', 'dull', 'stretched thin'],
      strong: ['exhausted', 'exhausting', 'exhaustion', 'fatigue', 'burnt out', 'burned out', 'burnout', 'depleted', 'wiped out', 'running on empty', 'no sleep', 'haven\'t slept', 'sleepless nights', 'can\'t move']
    }
  };

  var OPPOSITE = { joy: 'sadness', love: 'longing', calm: 'anxiety', hope: 'sadness', pride: 'shame', gratitude: 'loneliness' };

  var PHYS = [
    { id: 'sleep', label: 'Sleep', terms: ['slept', 'sleep', 'nap', 'napped', 'woke up', 'awake', 'insomnia', 'sleepless', 'overslept', 'early morning', 'stay up', 'stayed up', 'sleeping late'] },
    { id: 'body', label: 'Body', terms: ['headache', 'migraine', 'body ache', 'back pain', 'knee', 'fever', 'cold', 'cough', 'sore', 'cramps', 'period', 'stomach', 'nausea', 'sick', 'unwell', 'stiff', 'shoulders hurt'] },
    { id: 'move', label: 'Movement', terms: ['gym', 'workout', 'worked out', 'went for a walk', 'went for a run', 'morning walk', 'morning run', 'jog', 'jogging', 'yoga', 'stretch', 'stretched', 'cycling', 'swimming', 'swam', 'exercise', 'exercised', 'steps', 'danced', 'dancing', 'hiked', 'hiking', 'trained', 'training', 'cricket', 'football', 'badminton', 'marathon', 'walked home', 'long walk'] },
    { id: 'fuel', label: 'Food & drink', terms: ['ate', 'eating', 'hungry', 'food', 'meal', 'lunch', 'dinner', 'breakfast', 'coffee', 'chai', 'tea', 'water', 'drank', 'cooking', 'cooked', 'biryani', 'snack', 'snacks', 'sweets', 'hunger', 'starving', 'skipped lunch'] },
    { id: 'numb', label: 'Numbing', terms: ['cigarette', 'smoke', 'smoking', 'alcohol', 'drunk', 'wine', 'beer', 'whiskey', 'vape', 'energy drink', 'scrolling', 'scroll', 'screen time', 'doomscroll*'] }
  ];

  var MIND = [
    { id: 'focus', label: 'Focus & flow', terms: ['focused', 'focus', 'clear head', 'clarity', 'productive', 'in the zone', 'flow', 'finished', 'got it done', 'concentrated', 'sharp', 'on track', 'deep work'] },
    { id: 'fog', label: 'Fog & drift', terms: ['foggy', 'confused', 'scattered', 'distracted', 'distraction', 'procrastinat*', 'stuck', 'blank', 'can\'t think', 'zoning out', 'lost track', 'unfocused', 'drifting', 'all over the place'] },
    { id: 'overwhelm', label: 'Overwhelm', terms: ['overwhelmed', 'too much', 'piling up', 'no time', 'deadline', 'backlog', 'juggling', 'burning out', 'drowning', 'stretched', 'pressure'] },
    { id: 'rumination', label: 'Overthinking', terms: ['overthinking', 'replaying', 'reliving', 'second guessing', 'spiralling', 'spiraling', 'can\'t stop thinking', 'in my head', 'loop', 'unanswered'] },
    { id: 'resolve', label: 'Resolve', terms: ['decided', 'decision', 'boundar*', 'let go', 'letting go', 'forgive', 'forgave', 'move on', 'moving on', 'start again', 'committed', 'no more', 'chose', 'choosing me'] },
    { id: 'still', label: 'Stillness', terms: ['at ease', 'grounded', 'meditat*', 'journal', 'reflect*', 'slowed down', 'accept*', 'grateful', 'prayed', 'prayer', 'mindful'] }
  ];

  var THEMES = [
    { id: 'career', label: 'Work & career', terms: ['job', 'work', 'office', 'boss', 'manager', 'client', 'project', 'deadline', 'interview', 'promotion', 'resigned', 'resignation', 'quit', 'salary', 'hike', 'appraisal', 'startup', 'business', 'meeting', 'colleague', 'teammate', 'career', 'internship', 'freelance', 'shift', 'workload', 'overtime', 'layoff', 'offer letter', 'switching'] },
    { id: 'love', label: 'Love & partnership', terms: ['partner', 'boyfriend', 'girlfriend', 'husband', 'wife', 'fiance', 'fiancee', 'fiancé', 'fiancée', 'dating', 'date', 'breakup', 'broke up', 'divorce', 'relationship', 'romance', 'crush', 'ex', 'proposal', 'engaged', 'long distance', 'goodbye', 'moving away', 'moving to', 'moved away', 'farewell', 'leaving me', 'he is moving', 'she is moving', 'separate', 'miss him', 'miss her', 'miss them'] },
    { id: 'people', label: 'Family & friends', terms: ['family', 'mother', 'mom', 'mumma', 'amma', 'father', 'dad', 'papa', 'parents', 'sister', 'brother', 'didi', 'bhai', 'cousin', 'relative', 'friend', 'friends', 'best friend', 'roommate', 'in-laws', 'daughter', 'son', 'grandma', 'grandfather', 'nani', 'dadi', 'wedding'] },
    { id: 'money', label: 'Money', terms: ['money', 'salary', 'savings', 'saving up', 'debt', 'loan', 'emi', 'bills', 'budget', 'expensive', 'afford', 'broke', 'investment', 'sip', 'mutual fund', 'gold', 'rent', 'expenses', 'credit card', 'financial', 'tax'] },
    { id: 'home', label: 'Home & nest', terms: ['house', 'home', 'apartment', 'landlord', 'shifting', 'moving out', 'kitchen', 'clean*', 'laundry', 'groceries', 'plants', 'balcony', 'terrace', 'furniture', 'decor', 'my room', 'hostel'] },
    { id: 'health', label: 'Body & health', terms: ['doctor', 'hospital', 'medicine', 'therapy', 'therapist', 'mental health', 'diet', 'weight', 'injury', 'fever', 'gym', 'yoga', 'sleep', 'pcod', 'pcos', 'thyroid', 'meditat*', 'recovery', 'checkup', 'nutrition'] },
    { id: 'create', label: 'Creative life', terms: ['writing', 'wrote', 'poem', 'poetry', 'song', 'guitar', 'art', 'paint', 'sketch', 'design', 'photograph*', 'film', 'movie', 'cinema', 'book', 'reading', 'read', 'story', 'blog', 'camera', 'editing'] },
    { id: 'study', label: 'Study & exams', terms: ['exam', 'exams', 'study', 'studying', 'studied', 'college', 'university', 'degree', 'thesis', 'assignment', 'marks', 'grades', 'semester', 'course', 'upsc', 'cat', 'gate', 'entrance', 'mba', 'certification', 'syllabus'] },
    { id: 'growth', label: 'Self & becoming', terms: ['journal', 'journaling', 'healing', 'boundaries', 'self-care', 'self care', 'self love', 'growing', 'growth', 'reflect*', 'forgive', 'inner', 'better person', 'pattern', 'trigger*', 'childhood', 'silence', 'solitude'] },
    { id: 'faith', label: 'Faith & ritual', terms: ['prayer', 'prayed', 'god', 'temple', 'pooja', 'puja', 'meditat*', 'faith', 'church', 'mosque', 'spiritual', 'universe', 'aarti', 'fasting', 'vrat', 'diya'] },
    { id: 'travel', label: 'Travel & elsewhere', terms: ['trip', 'travel', 'flight', 'train', 'hotel', 'vacation', 'beach', 'mountain*', 'himalaya*', 'goa', 'visa', 'passport', 'tickets', 'airport', 'station', 'road trip', 'trek', 'wander', 'somewhere else'] },
    { id: 'tech', label: 'Screens & tools', terms: ['laptop', 'phone', 'iphone', 'android', 'app', 'code', 'coding', 'software', 'ai', 'upgrade', 'macbook', 'camera roll', 'instagram', 'social media', 'online'] }
  ];

  var PLACES = ['kitchen', 'balcony', 'terrace', 'rooftop', 'office', 'desk', 'cafe', 'coffee shop', 'train', 'metro', 'bus', 'auto', 'cab', 'road', 'airport', 'bedroom', 'bed', 'hospital', 'temple', 'gym', 'park', 'beach', 'mountains', 'hostel', 'room', 'bathroom', 'shower', 'market', 'mall', 'station', 'platform', 'hometown', 'goa', 'delhi', 'mumbai', 'ahmedabad', 'bangalore', 'bengaluru', 'pune', 'chennai', 'kolkata', 'jaipur', 'himalayas', 'london', 'paris', 'tokyo', 'bangalore'];
  var PEOPLE = ['mother', 'mom', 'mommy', 'mumma', 'amma', 'father', 'dad', 'papa', 'appa', 'parents', 'sister', 'brother', 'didi', 'bhai', 'cousin', 'partner', 'husband', 'wife', 'boyfriend', 'girlfriend', 'fiance', 'fiancee', 'fiancé', 'fiancée', 'friend', 'best friend', 'colleague', 'boss', 'manager', 'client', 'therapist', 'daughter', 'son', 'grandma', 'grandmother', 'nani', 'dadi', 'roommate', 'my ex', 'ex'];
  var TIMES = ['morning', 'afternoon', 'evening', 'night', 'midnight', 'late night', 'dawn', 'dusk', 'sunset', 'sunrise', 'after work', 'before work', 'weekend', 'monday', 'friday', 'sunday', 'saturday', 'tuesday', 'wednesday', 'thursday', '3 am', '2 am', 'monsoon', 'summer', 'winter', 'diwali', 'holiday'];
  var PROPS = ['rain', 'rains', 'raining', 'storm', 'heat', 'cold', 'fog', 'sun', 'sunlight', 'clouds', 'wind', 'curtains', 'fan', 'lights', 'candles', 'incense', 'cup', 'mug', 'chai', 'coffee', 'tea', 'notebook', 'letter', 'photograph', 'photo', 'mirror', 'clock', 'door', 'window', 'keys', 'phone', 'headphones', 'song', 'blanket', 'sweater', 'plant', 'flower', 'book', 'pen', 'cigarette', 'street', 'lamp', 'piggy bank', 'list'];
  var VERBS = ['waiting', 'walking', 'crying', 'working', 'laughing', 'hoping', 'sleeping', 'running', 'deciding', 'healing', 'leaving', 'staying', 'hiding', 'pretending', 'trying', 'missing', 'remembering', 'forgetting', 'planning', 'saving', 'studying', 'cooking', 'driving', 'scrolling', 'praying', 'building', 'breaking', 'holding', 'letting', 'drowning', 'wondering', 'counting', 'packing', 'unpacking'];
  var ADJ = ['matching', 'coordinated', 'matching set', 'black', 'white', 'navy', 'emerald', 'green', 'red', 'blue', 'beige', 'ivory', 'silk', 'cotton', 'linen', 'wool', 'tailored', 'bespoke', 'custom', 'new', 'good', 'nice', 'great', 'expensive', 'affordable', 'second-hand', 'secondhand', 'leather', 'gold', 'silver', 'oversized', 'minimal', 'comfy', 'quality', 'premium', 'simple', 'classic', 'vintage', 'cute', 'little', 'small', 'big', 'own', 'dream', 'small but'];
  var NEGATORS = /\b(not|no|never|isn\'t|wasn\'t|aren\'t|weren\'t|don\'t|doesn\'t|didn\'t|didnt|dont|cant|can\'t|couldn\'t|won\'t|wouldn\'t|hardly|barely|without|stopped|quit|stop)\b[\s\w]{0,12}$/;

  /* ------------------------------------------------------------- wishes/items */

  var ITEMS = [
    // clothing & adornment
    'blazer', 'blazer suit', 'suit', 'shirt', 'tshirt', 't-shirt', 'tee', 'dress', 'saree', 'sari', 'kurta', 'kurta set', 'kurti', 'lehenga', 'jeans', 'jacket', 'coat', 'trench coat', 'sneakers', 'shoes', 'heels', 'sandals', 'flats', 'boots', 'watch', 'bag', 'handbag', 'backpack', 'clutch', 'wallet', 'sunglasses', 'glasses', 'spectacles', 'ring', 'necklace', 'earrings', 'bracelet', 'perfume', 'fragrance', 'outfit', 'outfits', 'ethnic wear', 'gown', 'tuxedo', 'waistcoat', 'belt', 'tie', 'hoodie', 'sweater', 'dupatta', 'suit set', 'matching outfits',
    // tech & tools
    'laptop', 'macbook', 'phone', 'iphone', 'ipad', 'tablet', 'camera', 'film camera', 'lens', 'headphones', 'airpods', 'earbuds', 'speaker', 'monitor', 'keyboard', 'mouse', 'desk', 'chair', 'projector', 'console', 'playstation', 'ps5', 'xbox', 'gaming pc', 'printer', 'kindle', 'drone', 'guitar', 'piano', 'keyboard piano',
    // home & nest
    'sofa', 'bed', 'mattress', 'fridge', 'washing machine', 'ac', 'air conditioner', 'curtains', 'lamp', 'plants', 'bookshelf', 'bookshelf', 'house', 'apartment', 'flat', 'modular kitchen', 'dining table', 'rug', 'mirror', 'coffee machine', 'water purifier', 'geyser', 'balcony garden', 'painting', 'wall art', 'cushions', 'storage', 'wardrobe',
    // vehicles & else
    'car', 'bike', 'scooter', 'motorcycle', 'bicycle', 'cycle', 'tesla', 'enfield', 'auto',
    // experience, learning, money, self
    'vacation', 'holiday', 'trip', 'tickets', 'ticket', 'visa', 'course', 'degree', 'mba', 'certification', 'class', 'workshop', 'gym membership', 'membership', 'tattoo', 'skincare', 'serum', 'haircut', 'spa', 'retreat', 'mutual fund', 'sip', 'gold', 'jewellery', 'jewelry', 'investment', 'emergency fund', 'down payment', 'savings account', 'books', 'book', 'notebook', 'diary', 'pen', 'stationery'
  ];
  var ITEM_KIND = {
    product: ['blazer', 'suit', 'shirt', 'tshirt', 't-shirt', 'tee', 'dress', 'saree', 'sari', 'kurta', 'kurta set', 'kurti', 'lehenga', 'jeans', 'jacket', 'coat', 'trench coat', 'sneakers', 'shoes', 'heels', 'sandals', 'flats', 'boots', 'watch', 'bag', 'handbag', 'backpack', 'clutch', 'wallet', 'sunglasses', 'glasses', 'spectacles', 'ring', 'necklace', 'earrings', 'bracelet', 'perfume', 'fragrance', 'outfit', 'outfits', 'ethnic wear', 'gown', 'tuxedo', 'waistcoat', 'belt', 'tie', 'hoodie', 'sweater', 'dupatta', 'suit set', 'matching outfits', 'laptop', 'macbook', 'phone', 'iphone', 'ipad', 'tablet', 'camera', 'film camera', 'lens', 'headphones', 'airpods', 'earbuds', 'speaker', 'monitor', 'keyboard', 'mouse', 'desk', 'chair', 'projector', 'console', 'playstation', 'ps5', 'xbox', 'gaming pc', 'printer', 'kindle', 'drone', 'guitar', 'piano', 'keyboard piano', 'sofa', 'bed', 'mattress', 'fridge', 'washing machine', 'ac', 'air conditioner', 'curtains', 'lamp', 'plants', 'bookshelf', 'rug', 'cushions', 'storage', 'wardrobe', 'car', 'bike', 'scooter', 'motorcycle', 'bicycle', 'cycle', 'tesla', 'enfield', 'auto', 'tattoo', 'skincare', 'serum', 'coffee machine', 'water purifier', 'geyser', 'balcony garden', 'painting', 'wall art', 'books', 'book', 'notebook', 'diary', 'pen', 'stationery'],
    learning: ['course', 'degree', 'mba', 'certification', 'class', 'workshop'],
    experience: ['vacation', 'holiday', 'trip', 'tickets', 'ticket', 'visa', 'spa', 'retreat', 'gym membership', 'membership'],
    place: ['house', 'apartment', 'flat', 'modular kitchen', 'dining table'],
    money: ['mutual fund', 'sip', 'gold', 'jewellery', 'jewelry', 'investment', 'emergency fund', 'down payment', 'savings account']
  };
  var WISH_CUE = /\b(want|wanna|wish|need|needed|planning to (?:buy|get|own)|plan to (?:buy|get)|going to (?:buy|get)|saving up for|save up for|saving for|looking for|looking to buy|hoping to (?:get|buy|own)|one day i(?:'|’)?ll|someday i(?:'|’)?ll|dream of (?:owning|buying|getting|having)|wishlist|add(?:ing)? to (?:my )?(?:cart|wishlist)|order(?:ing)?|buy|buying|bought|afford|purchase|get myself|gift (?:myself|for)|budget for|treat myself|manifesting)\b/i;

  function vm_SENTENCE_START_CHECK(raw, tok) {
    var before = raw.slice(0, tok.i0).trim();
    return before.length > 0; // don't treat the very first word as a modifier
  }

  function tokenize(str) {
    var out = [];
    var re = /[A-Za-z0-9][A-Za-z0-9'’\-]*/g, m;
    while ((m = re.exec(str)) !== null) {
      out.push({ w: m[0].toLowerCase().replace(/[’]/g, "'"), raw: m[0], i0: m.index, i1: m.index + m[0].length });
    }
    return out;
  }

  function findItems(sentencesArr) {
    var found = [];
    sentencesArr.forEach(function (sentence) {
      var raw = sentence.replace(/^[\s\-•*\d.)]+/, '');
      var tk = tokenize(raw);
      if (!tk.length) return;
      var i = 0;
      while (i < tk.length) {
        var best = null;
        for (var L = 4; L >= 1; L--) {
          if (i + L > tk.length) continue;
          var phrase = tk.slice(i, i + L).map(function (t) { return t.w; }).join(' ');
          for (var k = 0; k < ITEMS.length; k++) {
            if (pluralOk(ITEMS[k], phrase)) { best = { len: L, item: ITEMS[k] }; break; }
          }
          if (best) break;
        }
        if (!best) { i++; continue; }
        var end = i + best.len;
        var itemText = raw.slice(tk[i].i0, tk[end - 1].i1);

        // ---- left expansion: quantity words/numbers + descriptive adjectives, any order
        var quant = '', adjs = [], j = i - 1, gl = 0;
        while (j >= 0 && gl++ < 7) {
          var t = tk[j], w = t.w;
          if (/^(a|an|the|our|my|his|her|their|some|any|this|that)$/.test(w)) { j--; continue; }
          if (/^\d+$/.test(w)) { quant = t.raw; j--; continue; }
          if (/^(one|two|three|four|five|six|seven|eight|nine|ten|few|couple)$/.test(w)) { quant = t.raw; j--; continue; }
          if (/^(pair|set)$/.test(w) && tk[j - 1] && tk[j - 1].w === 'of') {
            quant = t.raw + ' of' + (quant ? ' ' + quant : ''); j -= 2; continue;
          }
          if (ADJ.indexOf(w) >= 0) { adjs.unshift(t.raw); j--; continue; }
          break;
        }

        // ---- absorb a model name or set noun right after the item ("Kindle Paperwhite", "kurta set")
        var RIGHT_OK = { set: 1, pair: 1, combo: 1, edition: 1, collection: 1, kit: 1 };
        var attachEnd = end, g2 = 0;
        while (attachEnd < tk.length && g2++ < 2) {
          var nx = tk[attachEnd];
          var proper = /^[A-Z]/.test(nx.raw) && !/^(I|A|And|The|For|With|To|But|So|Also|Plus)$/.test(nx.raw);
          var modelish = /\d/.test(nx.raw) || /^[A-Z]{2,}\d*$/.test(nx.raw);
          if (RIGHT_OK[nx.w] || proper || modelish) { attachEnd++; continue; }
          break;
        }
        if (attachEnd > end) {
          itemText = raw.slice(tk[i].i0, tk[attachEnd - 1].i1);
          end = attachEnd;
        }

        // ---- proper noun right before the item ("Leh trip")
        if (j >= 0 && /^[A-Z]/.test(tk[j].raw) && vm_SENTENCE_START_CHECK(raw, tk[j]) ) {
          var pn = tk[j];
          if (!/^(I|A|An|The|We|He|She|It|They|My|Our|And|But|So|Also|Plus|For|With|To)$/.test(pn.raw)) {
            itemText = pn.raw + ' ' + itemText;
            j--;
          }
        }

        // ---- right expansion: a short purpose clause ("for the trio", "for our partners")
        var purpose = '', k2 = end;
        if (tk[k2] && /^(for|to|with)$/.test(tk[k2].w)) {
          var stops = { and: 1, plus: 1, but: 1, then: 1, also: 1, so: 1, because: 1, before: 1, after: 1, when: 1, while: 1, in: 1, at: 1, on: 1 };
          var m2 = k2, lastEnd = -1;
          while (m2 < tk.length && (m2 - k2) < 6) {
            var ww = tk[m2].w;
            if (m2 > k2 && stops[ww]) break;
            // stop at clause punctuation intervening between tokens
            var gap = raw.slice(tk[m2 - 1].i1, tk[m2].i0);
            if (/[;,.!?—]/.test(gap) && m2 > k2) break;
            lastEnd = tk[m2].i1; m2++;
          }
          if (lastEnd > 0) {
            var p = raw.slice(tk[k2].i0, lastEnd).replace(/[,;:.]+$/, '').trim();
            if (p.split(/\s+/).length >= 2 && p.split(/\s+/).length <= 6) purpose = p;
          }
        }

        var q = quant ? (quant.charAt(0).toUpperCase() + quant.slice(1)) : '';
        var phraseOut = [q, adjs.join(' '), itemText, purpose].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        phraseOut = cap(phraseOut);
        var kind = 'product', base = best.item;
        Object.keys(ITEM_KIND).forEach(function (kk) { if (ITEM_KIND[kk].indexOf(base) >= 0) kind = kk; });
        found.push({ text: phraseOut, item: base, kind: kind, quantity: quant || '' });
        i = end;
      }
    });
    found.sort(function (a, b) { return b.text.length - a.text.length; });
    var out = [];
    found.forEach(function (f) {
      var dup = out.some(function (o) {
        var a = o.text.toLowerCase(), b = f.text.toLowerCase();
        return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
      });
      if (!dup) out.push(f);
    });
    return out.slice(0, 6);
  }

  var STRONG_CUE = /\b(want|wanna|wished for|wish for|need|needed|need to get|planning to (?:buy|get|own)|plan to (?:buy|get)|going to (?:buy|get)|saving up for|save up for|saving for|buy|buying|bought|afford|purchase|get myself|get a new|order(?:ing)?|wishlist|treat myself|budget for|i(?:'|’)?m getting|i(?:'|’)?ll get|i(?:'|’)?ll buy|manifesting|to buy|to get)\b/i;
  var WEAK_CUE = /\b(looking for|looking to buy|hoping to (?:get|buy|own)|dream of (?:owning|buying|getting|having)|one day i(?:'|’)?ll|someday|thinking (?:about|of) (?:buying|getting)|would love|been eyeing|eyeing|backup list)\b/i;

  function detectWishes(text) {
    var sents = sentences(text);
    var lines = String(text).split('\n');
    var listLines = lines.filter(function (l) { return /^\s*(?:[-•*]|\d+[.)])\s*\S/.test(l); });
    var listSet = {};
    listLines.forEach(function (l) {
      var body = l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '');
      sentences(body).forEach(function (ss) { listSet[stripBullet(ss).toLowerCase()] = true; });
    });
    function stripBullet(t) { return String(t).replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim(); }

    var collected = [], strength = 0, bareLines = [];
    sents.forEach(function (sentence) {
      var isListLine = listSet[stripBullet(sentence).toLowerCase()] === true;
      var w = 0.32;
      if (STRONG_CUE.test(sentence)) w = 1;
      else if (WEAK_CUE.test(sentence)) w = 0.75;
      else if (isListLine) w = 0.5;
      else return; // no wish signal in this sentence at all
      var items = findItems([sentence]);
      items.forEach(function (it) {
        collected.push({ text: it.text, item: it.item, kind: it.kind, quantity: it.quantity, weight: w });
        strength += w;
      });
    });

    // bare lists: lines that are mostly just item names, no cues anywhere
    if (!collected.length) {
      lines.forEach(function (l) {
        var body = l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim();
        if (!body || body.split(/\s+/).length > 7) return;
        var found = findItems([body]);
        if (!found.length) return;
        var covered = found.reduce(function (acc, f) { return acc + f.text.split(/\s+/).length; }, 0);
        if (covered / body.split(/\s+/).length >= 0.5) bareLines.push(found[0]);
      });
      if (bareLines.length >= 2) {
        bareLines.forEach(function (it) {
          collected.push({ text: it.text, item: it.item, kind: it.kind, quantity: it.quantity, weight: 0.55 });
          strength += 0.55;
        });
      }
    }

    if (!collected.length) return { detected: false, items: [], summary: '', strength: 0, amounts: [], listDetected: listLines.length >= 2 };

    var strong = collected.filter(function (c) { return c.weight >= 1; }).length;
    var detected = strong >= 1 || (collected.length >= 2 && strength >= 1.0);
    if (!detected) return { detected: false, items: [], summary: '', strength: strength, amounts: [], listDetected: listLines.length >= 2 };

    var summary = collected.slice(0, 5).map(function (i) { return i.text; }).join(' + ');
    var amounts = uniq((String(text).match(/(?:₹|rs\.?|inr|\$)\s?\d[\d,]*(?:\.\d+)?k?/gi) || [])
      .concat(String(text).match(/\b\d+(?:\.\d+)?\s?k\b/gi) || [])
      .map(function (a) { return a.trim(); })).slice(0, 3);
    return {
      detected: true,
      amounts: amounts,
      items: collected,
      summary: summary,
      strength: Math.round(strength * 100) / 100,
      listDetected: listLines.length >= 2
    };
  }

  /* ---------------------------------------------------------------- entities */

  function findEntities(text) {
    var low = ' ' + String(text).toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
    function firstFrom(list) {
      var best = null;
      for (var i = 0; i < list.length; i++) {
        var idx = low.indexOf(' ' + list[i]);
        if (idx >= 0 && (best === null || idx < best.idx)) best = { idx: idx, v: list[i] };
      }
      return best ? best.v : '';
    }
    var all = function (list) {
      return uniq(list.filter(function (t) { return low.indexOf(' ' + t) >= 0; }));
    };
    var toks = words(text);
    var ger = uniq(toks.filter(function (t) { return VERBS.indexOf(t) >= 0; })).slice(0, 4);
    var nums = uniq(String(text).match(/\b\d+\b/g) || []).slice(0, 4);
    var props = all(PROPS);
    var times = all(TIMES);
    return {
      place: firstFrom(PLACES),
      places: all(PLACES),
      person: firstFrom(PEOPLE),
      people: all(PEOPLE),
      time: firstFrom(TIMES),
      times: times,
      props: props,
      gerunds: ger,
      numbers: nums,
      propsText: props.length ? props.join(', ') : ''
    };
  }

  /* ------------------------------------------------------------ emotion scan */

  var reCache = {};
  function variantsOf(term) {
    if (/\s/.test(term) || term.length < 3) return [term];
    var v = [term];
    if (/e$/.test(term)) v.push(term.slice(0, -1) + 'ed', term.slice(0, -1) + 'ing', term + 's', term + 'd');
    else if (/[^aeiou]y$/.test(term)) v.push(term.slice(0, -1) + 'ies', term.slice(0, -1) + 'ied', term + 's');
    else if (/(s|x|ch|sh)$/.test(term)) v.push(term + 'es', term + 'ed', term + 'ing');
    else v.push(term + 's', term + 'es', term + 'ed', term + 'ing', term + 'ly');
    return v;
  }
  function regexFor(term) {
    if (reCache[term]) return reCache[term];
    var pat;
    if (term.endsWith('*')) {
      pat = '\\b' + term.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[a-z]*';
    } else if (/\s/.test(term)) {
      pat = '\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b';
    } else {
      var vs = variantsOf(term).map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
      vs.sort(function (a, b) { return b.length - a.length; });
      pat = '\\b(?:' + vs.join('|') + ')\\b';
    }
    var re = new RegExp(pat, 'gi');
    reCache[term] = re;
    return re;
  }
  function scanTerm(text, term, weight) {
    var re = regexFor(term);
    re.lastIndex = 0;
    var score = 0, hits = [];
    var m, n = 0;
    while ((m = re.exec(text)) !== null && n < 6) {
      n++;
      var pre = text.slice(Math.max(0, m.index - 26), m.index).toLowerCase();
      var damp = NEGATORS.test(pre) ? 0.25 : 1;
      score += weight * damp;
      hits.push({ term: term, negated: damp < 1, index: m.index, weight: weight * damp });
    }
    return { score: score, hits: hits };
  }
  function scanGroup(text, terms, weight) {
    var total = 0, hits = [];
    terms.forEach(function (t) {
      var r = scanTerm(text, t, weight);
      total += r.score;
      hits = hits.concat(r.hits);
    });
    return { score: total, hits: hits };
  }

  /* -------------------------------------------------------------- life phases */


  /* ==========================================================================
     ATMOSPHERES — every entry gets a scene. The moment page paints itself with
     it: a background gradient, an ink, an accent and a particle weather, so the
     page feels like the place the words came from. All palettes verified for
     contrast in test/contrast.test.js (ink >= 7:1, accent >= 4.5:1 on the
     lightest gradient stop).
     ========================================================================*/
  var SCENES = {
    night:   { key: 'night',   label: 'the small hours',  ink: '#f4efe6', ink2: '#cec6b7', accent: '#e0b877', stops: ['#1b2440', '#293757'],            particles: 'star',  line: 'a dark room and one lit screen' },
    rain:    { key: 'rain',    label: 'rain',             ink: '#f4efe6', ink2: '#c9c6bd', accent: '#9fc4d6', stops: ['#1b2b34', '#263d49'],            particles: 'rain',  line: 'water on the window, slow and steady' },
    dawn:    { key: 'dawn',    label: 'first light',      ink: '#f4efe6', ink2: '#d6c9bd', accent: '#f0b87e', stops: ['#2a1e33', '#3d2937', '#503123'], particles: 'bokeh', line: 'the hour before the day decides' },
    gold:    { key: 'gold',    label: 'celebration',      ink: '#f4efe6', ink2: '#d6c7b4', accent: '#e6bd82', stops: ['#2a1d14', '#452d1d'],            particles: 'mote',  line: 'warm light, loud room, everyone laughing' },
    temple:  { key: 'temple',  label: 'quiet faith',      ink: '#f4efe6', ink2: '#d6c6b2', accent: '#e0ac52', stops: ['#241812', '#3b2717'],            particles: 'smoke', line: 'incense, bare feet, a murmur you know by heart' },
    sea:     { key: 'sea',     label: 'somewhere else',   ink: '#f4efe6', ink2: '#c6cbc6', accent: '#84cbd0', stops: ['#12262c', '#1d3d45'],            particles: 'bokeh', line: 'salt air and a horizon that keeps moving' },
    city:    { key: 'city',    label: 'the city',         ink: '#f4efe6', ink2: '#cbc9c4', accent: '#a8b8cc', stops: ['#1b2029', '#2b3341'],            particles: 'dust',  line: 'screens, traffic, another deadline' },
    kitchen: { key: 'kitchen', label: 'home',             ink: '#f4efe6', ink2: '#d4c6b2', accent: '#e0b073', stops: ['#241a14', '#3a281a'],            particles: 'steam', line: 'the kettle, the light over the table' },
    rose:    { key: 'rose',    label: 'tenderness',       ink: '#f4efe6', ink2: '#d8c6c9', accent: '#eaaebc', stops: ['#2a1a24', '#452a3a'],            particles: 'petal', line: 'someone close enough to change the temperature' },
    moss:    { key: 'moss',    label: 'growing things',   ink: '#f4efe6', ink2: '#c8cdc4', accent: '#a2cbae', stops: ['#18251c', '#263a2a'],            particles: 'dust',  line: 'long walks, deep breath, small repairs' },
    paper:   { key: 'paper',   label: 'an ordinary day',  ink: '#f4efe6', ink2: '#cec8bb', accent: '#d3c6ae', stops: ['#241f19', '#34302a'],            particles: 'dust',  line: 'nothing loud happened, and that was the gift' },
    ember:   { key: 'ember',   label: 'heat',             ink: '#f4efe6', ink2: '#d6c3b2', accent: '#e78f5c', stops: ['#26170f', '#3e2519'],            particles: 'ember', line: 'something burnt and kept burning' },
    snow:    { key: 'snow',    label: 'cold',             ink: '#f4efe6', ink2: '#cbcbc9', accent: '#c2d6e0', stops: ['#1c242c', '#2c3a47'],            particles: 'snow',  line: 'breath visible, hands in pockets' },
    heart:   { key: 'heart',   label: 'ache',             ink: '#f4efe6', ink2: '#d0c6cd', accent: '#c9aede', stops: ['#201a2a', '#342a44'],            particles: 'dust',  line: 'the room after somebody left it' }
  };

  var SCENE_CUES = [
    { key: 'rain',   re: /\b(rain|rains|rained|raining|rainy|monsoon|drizzle|downpour|petrichor|umbrella|wet|storm|thunder)\b/i },
    { key: 'snow',   re: /\b(snow|snowing|winter|shimla|manali|december cold|freezing|blanket weather|fog)\b/i },
    { key: 'sea',    re: /\b(sea|ocean|beach|waves|shore|coast|goa|andaman|sail|boat|harbour|harbor)\b/i },
    { key: 'temple', re: /\b(temple|pooja|puja|prayer|prayed|praying|aarti|diya|church|mosque|god|vrat|fasting|faith|darshan)\b/i },
    { key: 'gold',   re: /\b(wedding|haldi|sangeet|mehendi|reception|birthday|anniversary|diwali|festival|celebrat\w*|party|danced|dancing|cake|gift)\b/i },
    { key: 'dawn',   re: /\b(dawn|sunrise|first light|early morning|5 am|6 am|new start|fresh start|start over|new beginning)\b/i },
    { key: 'night',  re: /\b(3 am|2 am|4 am|midnight|late night|sleepless|insomnia|cannot sleep|can't sleep|stars|moon|night sky)\b/i },
    { key: 'heart',  re: /\b(breakup|broke up|cried|crying|tears|heartbreak|goodbye|moving away|move to |miss him|miss her|alone|lonely|hospital|sick|passed away|funeral)\b/i },
    { key: 'ember',  re: /\b(angry|furious|rage|shouted|screamed|argument|fight|snapped|slamming|slammed|unfair|betrayed)\b/i },
    { key: 'kitchen',re: /\b(kitchen|chai|coffee|dinner|lunch|breakfast|cooked|cooking|dosa|biryani|rice|dal|fridge|kettle|food|ate|eating|recipe)\b/i },
    { key: 'moss',   re: /\b(gym|workout|yoga|morning walk|walk|park|garden|plants|terrace|balcony|healing|therapy|meditat\w*|stretch|run|running)\b/i },
    { key: 'city',   re: /\b(office|desk|client|deadline|meeting|commute|traffic|metro|local train|cab|auto|appraisal|promotion|interview|salary|mumbai|delhi|bangalore|bengaluru|ahmedabad|city)\b/i },
  ];

  function sceneOf(sig) {
    var text = sig.raw;
    // 1 — explicit scene cues in the words themselves
    var hit = null;
    for (var i = 0; i < SCENE_CUES.length; i++) {
      if (SCENE_CUES[i].re.test(text)) { hit = SCENE_CUES[i].key; break; }
    }
    // 2 — otherwise let the reading decide
    if (!hit) {
      var e = sig.emotions.byId;
      var dom = (sig.emotions.top[0] && sig.emotions.top[0].id) || 'calm';
      var byEmotion = {
        joy: 'gold', gratitude: 'gold', pride: 'gold', love: 'rose', calm: 'moss',
        hope: 'dawn', longing: 'night', loneliness: 'heart', sadness: 'heart',
        anxiety: 'night', anger: 'ember', shame: 'heart', exhaustion: 'city'
      };
      var byShelf = {
        wishes: 'gold', joy: 'gold', heart: 'heart', love: 'rose', career: 'city',
        quiet: 'paper', daily: 'city', body: 'moss', nest: 'kitchen', self: 'moss'
      };
      hit = byShelf[sig.primary && sig.primary.id] || byEmotion[dom] || 'paper';
      // texture from the time of day, but only when nothing louder is happening
      var t = (sig.entities.time || '').toLowerCase();
      if (/morning|sunrise|dawn/.test(t) && hit === 'paper') hit = 'dawn';
      if (/night|midnight|3 am|2 am/.test(t) && (hit === 'paper' || hit === 'city')) hit = 'night';
      if (dom === 'calm' && /night|midnight|3 am/.test(t)) hit = 'night';
      if (e.sadness > 1.2 && (sig.entities.props || []).indexOf('rain') >= 0) hit = 'rain';
    }
    var sc = SCENES[hit] || SCENES.paper;
    var parts = [];
    if (sig.entities.time) parts.push(sig.entities.time);
    if (sig.entities.place) parts.push(sig.entities.place);
    return {
      key: sc.key, label: sc.label, ink: sc.ink, ink2: sc.ink2, accent: sc.accent,
      stops: sc.stops, particles: sc.particles, line: sc.line,
      where: parts.join(' · ')
    };
  }

  var SHELVES = [
    { id: 'wishes', name: 'Wishes & Tangible Dreams', blurb: 'Things you want to own, go to, or grow into.' },
    { id: 'joy', name: 'Moments of Joy', blurb: 'Light you will want to find again.' },
    { id: 'heart', name: 'Heartbreak & Healing', blurb: 'Where it hurt, and where it started closing.' },
    { id: 'love', name: 'Love & People', blurb: 'The ones who live in your sentences.' },
    { id: 'career', name: 'Career Crossroads', blurb: 'Desks, deadlines, and the fork in the road.' },
    { id: 'quiet', name: 'Quiet Dreams', blurb: 'Soft plans that haven\'t asked for permission yet.' },
    { id: 'daily', name: 'Daily Struggles', blurb: 'The ordinary weight of getting through a day.' },
    { id: 'body', name: 'Body, Mind & Health', blurb: 'What your body was saying while you were busy.' },
    { id: 'nest', name: 'Money & Nest', blurb: 'Bills, savings, rent, and the shape of home.' },
    { id: 'self', name: 'Self & Becoming', blurb: 'Patterns noticed, boundaries drawn, versions of you.' }
  ];
  var SHELF_BY_ID = {};
  SHELVES.forEach(function (s) { SHELF_BY_ID[s.id] = s; });

  function scoreShelves(sig) {
    var e = sig.emotions.rel, themes = sig.themeIds, w = sig.wish;
    var strength = clamp((sig.emotions.ranked.length ? sig.emotions.ranked[0].score : 1.4) / 2.0, 0.45, 1.35);
    var t = function (id, v) {
      var sc = sig.themeScores[id] || 0;
      if (sc <= 0) return 0;
      return v * clamp(0.45 + sc / 3, 0.45, 1.25);
    };
    var s = {};
    function add(id, v) { s[id] = (s[id] || 0) + v; }

    if (w.detected) add('wishes', 4.6 * clamp(strength, 0.5, 1.35) + Math.min(w.items.length, 4) * 0.7);
    add('joy', (e.joy * 2.9 + e.gratitude * 1.35 + e.pride * 1.25 + e.love * 1.15 + e.calm * 1.05 + e.hope * 0.75) * strength);
    add('heart', (e.sadness * 2.9 + e.loneliness * 2.1 + e.longing * 1.9 + e.shame * 1.0 + t('love', 0.55) + t('growth', 0.5) + (sig.mindScores.resolve > 0 ? 0.6 : 0)) * strength);
    add('love', (e.love * 2.6 + e.gratitude * 1.15 + e.joy * 0.7 + e.loneliness * 0.9) * strength + t('people', 1.5) + t('love', 1.1));
    add('career', (e.anxiety * 1.5 + e.anger * 1.3 + e.pride * 1.15 + e.exhaustion * 1.05 + e.hope * 0.6) * strength + t('career', 1.6));
    add('quiet', (e.hope * 2.3 + e.longing * 1.85 + e.calm * 1.35 + e.gratitude * 0.8) * strength + t('growth', 0.45) + t('create', 0.65) + t('travel', 0.7) - e.anger * 1.6 - e.shame * 0.8);
    add('daily', (e.exhaustion * 2.6 + e.anger * 1.5 + e.anxiety * 1.0 + e.shame * 0.8) * strength + t('money', 0.5) + t('home', 0.5) + t('career', 0.35));
    add('body', t('health', 2.0) + sig.physCount * 0.8 + (e.exhaustion * 1.2 + e.anxiety * 0.5) * strength - e.joy * 1.3 - e.love * 0.5);
    add('nest', t('money', 1.9) + t('home', 1.4) + (e.anxiety * 0.5 + e.hope * 0.45) * strength);
    add('self', t('growth', 1.7) + t('faith', 0.7) + sig.mindScores.resolve * 0.85 + (e.shame * 1.35 + e.pride * 1.0 + e.hope * 0.7) * strength);

    Object.keys(s).forEach(function (k) { if (s[k] < 0) s[k] = 0; });
    var arr = Object.keys(s).map(function (k) {
      return { id: k, name: SHELF_BY_ID[k].name, blurb: SHELF_BY_ID[k].blurb, score: Math.round(s[k] * 100) / 100 };
    }).sort(function (a, b) { return b.score - a.score || SHELVES.findIndex.call(SHELVES, function (x) { return x.id === a.id; }) - SHELVES.findIndex.call(SHELVES, function (x) { return x.id === b.id; }); });
    if (!arr.length) arr = [{ id: 'daily', name: SHELF_BY_ID.daily.name, blurb: SHELF_BY_ID.daily.blurb, score: 0 }];
    return arr;
  }

  function shelfSupported(id, sig) {
    var e = sig.emotions.byId;
    var has = function (a) { return a.some(function (k) { return (e[k] || 0) > 0.3; }); };
    switch (id) {
      case 'heart': return has(['sadness', 'loneliness', 'longing', 'shame']);
      case 'joy': return has(['joy', 'gratitude', 'calm', 'love', 'pride', 'hope']);
      case 'wishes': return sig.wish.detected;
      case 'body': return sig.physCount > 0 || (sig.themeScores.health || 0) > 0;
      case 'nest': return (sig.themeScores.money || 0) > 0 || (sig.themeScores.home || 0) > 0 || has(['anxiety', 'hope']);
      case 'career': return (sig.themeScores.career || 0) > 0 || has(['anxiety', 'pride', 'anger', 'exhaustion']);
      case 'daily': return has(['exhaustion', 'anger', 'anxiety', 'shame']) || (sig.themeScores.home || 0) > 0 || (sig.themeScores.career || 0) > 0;
      case 'love': return has(['love', 'gratitude', 'loneliness']) || (sig.themeScores.people || 0) + (sig.themeScores.love || 0) > 0;
      case 'quiet': return has(['hope', 'longing', 'calm', 'gratitude']);
      case 'self': return has(['shame', 'pride', 'hope', 'calm']) || (sig.mindScores.resolve || 0) > 0 || (sig.themeScores.growth || 0) > 0;
      default: return true;
    }
  }

  function reasonFor(shelfId, sig) {
    var top = sig.emotions.top.map(function (t) { return t.label.toLowerCase(); });
    var theme = sig.themes[0] ? sig.themes[0].label.toLowerCase() : '';
    var e = sig.emotions;
    switch (shelfId) {
      case 'wishes': return sig.wish.items.length + ' tangible ' + (sig.wish.items.length === 1 ? 'item' : 'items') + ' named in the wish';
      case 'joy': return 'light, ease and warmth carry this one (' + (sig.emotions.top[0] ? sig.emotions.top[0].label.toLowerCase() : 'joy') + ')';
      case 'heart': return 'grief and longing sit close to the surface' + (sig.mind.resolve > 0.4 ? ', with healing already starting' : '');
      case 'love': return 'the people in it take up most of the frame' + (theme ? ' (' + theme + ')' : '');
      case 'career': return 'work pressure and decisions' + (sig.emotions.byId.anxiety > 0.3 ? ' with anxiety threaded through' : '');
      case 'quiet': return 'hopeful and unhurried — a dream still in soft focus';
      case 'daily': return 'the ordinary grind: ' + (e.exhaustion > e.joy ? 'tiredness outweighs the rest' : 'small frictions piling up');
      case 'body': return sig.phys.length ? 'the body speaks first here (' + sig.phys.map(function (p) { return p.label.toLowerCase(); }).join(', ') + ')' : 'health is the undercurrent';
      case 'nest': return 'money, rent and the shape of home are the anchor of this entry';
      case 'self': return 'you are watching yourself change in real time';
      default: return 'closest emotional match: ' + top.join(', ');
    }
  }

  /* -------------------------------------------------------------------- mood */

  function valenceOf(e) {
    var pos = e.joy + e.love * 0.8 + e.gratitude * 0.9 + e.hope * 0.7 + e.pride * 0.7 + e.calm * 0.6;
    var neg = e.sadness + e.anxiety + e.anger + e.shame + e.exhaustion * 0.7 + e.loneliness + e.longing * 0.6;
    var tot = pos + neg;
    return tot === 0 ? 0 : clamp((pos - neg) / tot, -1, 1);
  }

  /* ------------------------------------------------------------------ titles */

  var EMO_NOUN = {
    joy: 'joy', love: 'love', gratitude: 'gratitude', pride: 'pride', hope: 'hope', calm: 'quiet',
    sadness: 'ache', longing: 'longing', loneliness: 'the quiet', anxiety: 'dread', anger: 'anger',
    shame: 'shame', exhaustion: 'tiredness'
  };
  var EMO_ADJ = {
    joy: 'bright', love: 'tender', gratitude: 'warm', pride: 'quietly proud', hope: 'hopeful',
    calm: 'slow', sadness: 'heavy', longing: 'faraway', loneliness: 'silent', anxiety: 'restless',
    anger: 'burning', shame: 'careful', exhaustion: 'hollow'
  };
  var TONE = {
    joy: 'warm', love: 'tender', gratitude: 'warm', pride: 'steady', hope: 'hopeful', calm: 'slow',
    sadness: 'grieving', longing: 'wistful', loneliness: 'hushed', anxiety: 'unsteady',
    anger: 'sharp', shame: 'honest', exhaustion: 'hollow'
  };
  var THEME_LINE = {
    career: 'the work that never quite finishes', love: 'the person you keep writing about',
    people: 'the people who shaped the room', money: 'the bills and the arithmetic',
    home: 'the small geography of home', health: 'the body keeping score', create: 'the thing you make to stay alive',
    study: 'the syllabus and the self', growth: 'the version of you being built', faith: 'the quiet you pray into',
    travel: 'the somewhere else you keep circling', tech: 'the screens that hold your hours'
  };
  var TITLE_CONCEPTS = {
    career: ['Deadline', 'Resignation Letter', 'Salary', 'Interview Room', 'Monday'],
    love: ['Goodbye', 'Long Distance', 'Phone Call', 'Anniversary', 'Return'],
    people: ['Wedding', 'Kitchen Table', 'Family Group Chat', 'Photograph Album', 'Drive Home'],
    money: ['Bills', 'Arithmetic', 'Piggy Bank', 'Rent', 'Savings'],
    home: ['Front Door', 'Balcony', 'Landlord', 'Laundry', 'Moving Day'],
    health: ['Body', 'Appointment', 'Deep Breath', 'Sleep', 'Recovery'],
    create: ['Notebook', 'Camera', 'First Draft', 'Song', 'Edit'],
    study: ['Syllabus', 'Exam Hall', 'Notes', 'Last Chapter', 'All-Nighter'],
    growth: ['Mirror', 'Boundary', 'Apology', 'Pattern', 'Beginning'],
    faith: ['Lamp', 'Prayer', 'Vow', 'Temple Step', 'Quiet Hour'],
    travel: ['Ticket', 'Departure Gate', 'Guest House', 'Window Seat', 'Long Road'],
    tech: ['Screen', 'Inbox', 'Unread Message', 'Battery', 'Notification'],
    joy: ['Small Happiness', 'Good News', 'Second Helping', 'Loose Afternoon', 'Light'],
    heart: ['Goodbye', 'Voicemail', 'Empty Chair', 'Long Way Home', 'Aftermath'],
    daily: ['Monday', 'To-Do List', 'Commute', 'Leftovers', 'Long Day'],
    quiet: ['Open Window', 'Slow Morning', 'Half-Plan', 'Someday', 'Daydream'],
    body: ['Body', 'Deep Breath', 'Appetite', 'Sleep', 'Long Walk'],
    nest: ['Rent', 'Kitchen Table', 'Savings', 'Little Flat', 'Down Payment'],
    self: ['Mirror', 'Boundary', 'Apology', 'Pattern', 'Becoming'],
    wishes: ['Long List', 'Wishlist', 'Big Save', 'Someday Money', 'Plan']
  };
  var THEME_OBJ = {
    career: 'the deadline', love: 'the phone', people: 'the kitchen table', money: 'the bills',
    home: 'the front door', health: 'the body', create: 'the notebook', study: 'the syllabus',
    growth: 'the mirror', faith: 'the lamp', travel: 'the ticket', tech: 'the screen',
    heart: 'the goodbye', wishes: 'the list', self: 'the mirror',
    joy: 'the light', quiet: 'the window', daily: 'the commute', body: 'the body', nest: 'the rent'
  };
  var PLACE_FALLBACK = {
    career: 'home', love: 'home', people: 'home', money: 'home',
    home: 'home', health: 'home', create: 'home', study: 'home',
    growth: 'home', faith: 'home', travel: 'home', tech: 'home'
  };

  var SMALL_WORDS = { a: 1, an: 1, the: 1, and: 1, of: 1, to: 1, in: 1, on: 1, at: 1, for: 1, with: 1, or: 1, my: 1, our: 1, plus: 1 };
  function titleCase(str) {
    return String(str).split(/\s+/).map(function (w, i) {
      var low = w.toLowerCase();
      if (i > 0 && SMALL_WORDS[low]) return low;
      return low.charAt(0).toUpperCase() + low.slice(1);
    }).join(' ');
  }

  function fill(tpl, c) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) { return c[k] !== undefined && c[k] !== '' ? c[k] : ''; })
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.:;])/g, '$1')
      .replace(/\s*—\s*/g, ' — ')
      .replace(/\b([Aa])\s+(?=[aeiouAEIOU])/g, function (m, a) { return (a === 'A' ? 'An' : 'an') + ' '; })
      .trim();
  }

  var BANKS = {
    cinematic: [
      'Interior — {Place}, {Time}',
      'Cut To: {Place}, {Time}',
      'The {time} That Wouldn\'t End',
      '{Place}, {Time} — Take {N}',
      'Scene: {Emo} in Wide Angle',
      'A Long Shot of {Place}'
    ],
    poetic: [
      '{C} And One Longing',
      'Small {C}, Loud {Emo}',
      'Where the {Emo} Keeps Coming Back',
      'The Weight of {C}',
      'A {EmoAdjCap} Kind of {Time}',
      'Everything I Didn\'t Say About {C}',
      '{C} And The {Emo}'
    ],
    plain: [
      'About {Item}',
      'Notes From a {EmoAdjCap} {Time}',
      'What Actually Happened on {Time}',
      'I Want {Item}, And Other Problems',
      'Talking To Myself About {Them}',
      'Nothing Big. Everything, Still.',
      '{C}, And Other Small Things'
    ],
    tender: [
      'If You Were Here For {Time}',
      'For {C}, Quietly',
      'The {C} That Remembers You',
      'Hold This {Time} Gently',
      'Something Soft About {Place}'
    ],
    wry: [
      'Anyway, {Place}.',
      'Me, {Place}, And Unhelpful Thoughts',
      'Fine. {EmoAdjCap} Then.',
      'The {Emo} Has Entered the Chat',
      'Not Today, {C}',
      '{C}, You Have Won Again'
    ],
    short: [
      '{Place}, {Time}',
      '{Emo} in {N} Words',
      '{ItemShort} & Rain',
      'Almost {EmoAdj}',
      '{C}, Briefly'
    ],
    wish: [
      'The {ItemTitle} List',
      'What I Want, Said Plainly',
      'Saving Up For {ItemTitle}',
      'A Short List of Large Wants',
      '{ItemTitle} & Everything It Means',
      'To Own, And To Become',
      'The Things I Am Working Toward'
    ]
  };

  var AT_PLACES = { desk: 1, 'kitchen table': 1, bed: 1, terrace: 1, balcony: 1, rooftop: 1, platform: 1, floor: 1, 'temple step': 1, window: 1, door: 1, 'front door': 1 };
  var IN_PLACES = { kitchen: 1, office: 1, house: 1, station: 1, cafe: 1, 'coffee shop': 1, park: 1, mall: 1, temple: 1, gym: 1, airport: 1, hospital: 1, hostel: 1, room: 1, bedroom: 1, bathroom: 1, shower: 1, market: 1, train: 1, metro: 1, bus: 1, auto: 1, cab: 1 };
  var CITY = /^(goa|delhi|mumbai|ahmedabad|bangalore|bengaluru|pune|chennai|kolkata|jaipur|london|paris|tokyo|himalayas|the himalayas|leh)$/;
  function placePhrase(place) {
    if (!place) return 'at home';
    var p = String(place).toLowerCase().replace(/^the\s+/, '');
    if (AT_PLACES[p]) return 'at the ' + p;
    if (IN_PLACES[p]) return 'in the ' + p;
    if (CITY.test(p)) return 'in ' + cap(p);
    return 'in the ' + p;
  }

  function contextOf(sig) {
    var x = sig.entities;
    var cKey = (sig.primary && TITLE_CONCEPTS[sig.primary.id]) ? sig.primary.id
      : (sig.themeIds.length && TITLE_CONCEPTS[sig.themeIds[0]]) ? sig.themeIds[0]
      : ((sig.emotions.top[0] && TITLE_CONCEPTS[sig.emotions.top[0].id]) ? sig.emotions.top[0].id : 'growth');
    var cList = TITLE_CONCEPTS[cKey] || TITLE_CONCEPTS.growth;
    var concept = cList[hash(JSON.stringify(x) + cKey) % cList.length];
    var theme = (sig.primary && THEME_OBJ[sig.primary.id]) ? sig.primary.id : (sig.themeIds.length ? sig.themeIds[0] : (sig.themes[0] ? sig.themes[0].id : 'growth'));
    var top = sig.emotions.top[0] ? sig.emotions.top[0].id : 'calm';
    var item = '';
    if (sig.wish.items.length) {
      var it = sig.wish.items[0];
      item = it.text.replace(/\s+for\s+.*$/i, '').replace(/\s+(to|with)\s+.*$/i, '');
      if (/^\d|^(one|two|three|four|five)\b/i.test(item)) item = item; // keep the count, it reads well
    }
    var generic = ['silence', 'small things', 'the small hours', 'second thoughts', 'the long way home', 'half-told truths', 'unfinished things'];
    var seedBase = hash(JSON.stringify(x)) % generic.length;
    var themeObj = THEME_OBJ[theme] || '';
    var obj = x.props[0] || item || themeObj || (x.gerunds[0] || '') || x.places[0] || generic[seedBase];
    var them = x.person || (sig.themeIdList.indexOf('people') >= 0 ? 'them' : 'home');
    return {
      Place: cap(x.place || PLACE_FALLBACK[theme] || 'the kitchen'),
      place: x.place || PLACE_FALLBACK[theme] || 'the kitchen',
      Time: cap(x.time || 'late evening'),
      PlacePhrase: placePhrase(x.place || PLACE_FALLBACK[theme] || 'the kitchen'),
      time: x.time || 'late evening',
      Emo: cap(EMO_NOUN[top] || 'quiet'),
      emo: EMO_NOUN[top] || 'quiet',
      EmoAdj: EMO_ADJ[top] || 'soft',
      EmoAdjCap: cap(EMO_ADJ[top] || 'soft'),
      Item: cap(item || obj || 'small things'),
      item: item || obj || 'small things',
      ItemShort: cap((item || obj || 'small things').replace(/^\d+\s*/, '').replace(/^(one|two|three|four|five|six)\s+/i, '')),
      ItemTitle: titleCase((item || obj || 'small things').replace(/^\d+\s*/, '')),
      Obj: cap(obj || 'silence'),
      obj: obj || 'silence',
      ObjTitle: titleCase(String(obj || 'silence').replace(/^the\s+/i, '')),
      ObjShort: String(obj || 'silence').replace(/^the\s+/i, ''),
      Them: cap(them),
      them: them,
      C: concept,
      c: concept.toLowerCase(),
      N: (x.numbers[0] && Number(x.numbers[0]) > 1 && Number(x.numbers[0]) < 6) ? x.numbers[0] : String(2 + (hash(JSON.stringify(x)) % 3)),
      person: x.person || 'you',
      Person: cap(x.person || 'you')
    };
  }

  function styleFor(sig, requested) {
    if (requested && BANKS[requested]) return requested;
    var top = sig.emotions.top[0] ? sig.emotions.top[0].id : 'calm';
    if (sig.wish.detected) return 'wish';
    return ({
      joy: 'cinematic', gratitude: 'tender', love: 'tender', pride: 'plain', hope: 'poetic',
      calm: 'poetic', sadness: 'poetic', longing: 'poetic', loneliness: 'tender',
      anxiety: 'cinematic', anger: 'wry', shame: 'tender', exhaustion: 'plain'
    })[top] || 'cinematic';
  }

  function generateTitles(sig, requestedStyle, seed) {
    seed = seed || 0;
    var style = styleFor(sig, requestedStyle);
    var bank = BANKS[style];
    var c = contextOf(sig);
    var base = hash(JSON.stringify(c) + style);
    var order = bank.map(function (_, i) { return i; });
    for (var q = order.length - 1; q > 0; q--) {
      var r = Math.floor(rnd(base + seed * 31 + q * 7) * (q + 1));
      var tmp = order[q]; order[q] = order[r]; order[r] = tmp;
    }
    var out = [];
    var sigWords = function (t) {
      var stop = { a: 1, an: 1, the: 1, and: 1, of: 1, to: 1, in: 1, on: 1, at: 1, for: 1, with: 1, i: 1, my: 1, it: 1, that: 1, this: 1, is: 1 };
      return words(t).filter(function (w) { return !stop[w] && w.length > 2; });
    };
    for (var i = 0; i < order.length && out.length < 3; i++) {
      var tpl = bank[order[i]];
      var text = fill(tpl, c);
      if (!text) continue;
      var mine = sigWords(text);
      var clash = out.some(function (o) {
        var theirs = sigWords(o.text);
        var shared = mine.filter(function (w) { return theirs.indexOf(w) >= 0; });
        return shared.length >= 2;
      });
      if (clash) continue;
      out.push({ text: text, style: style });
    }
    // guarantee three, even for tiny entries
    var extras = ['A {EmoAdj} {Time}', 'Notes on {Them}', 'The {Obj} and I'];
    var e = 0;
    while (out.length < 3 && e < extras.length) {
      out.push({ text: fill(extras[e], c), style: style });
      e++;
    }
    return out.map(function (o, i) {
      var txt = titleCase(o.text);
      return { text: txt, style: o.style, id: 'title-' + i + '-' + hash(txt) };
    });
  }

  /* ----------------------------------------------------------- title casing */
  var TC_SMALL = {
    a: 1, an: 1, the: 1, and: 1, or: 1, but: 1, nor: 1, of: 1, to: 1, in: 1, on: 1, at: 1, for: 1,
    with: 1, from: 1, by: 1, as: 1, than: 1, that: 1, into: 1, over: 1, after: 1, but: 1, up: 1,
    down: 1, off: 1, out: 1, about: 1, around: 1, through: 1, near: 1, under: 1, my: 1
  };
  var TC_KEEP_LOWER = { am: 1, pm: 1 };

  /* Title case that leaves small words small, honours an em dash or colon as a
     fresh start, and never mangles "3 am" or an acronym already shouting. */
  function titleCase(t) {
    var words = String(t).split(/\s+/);
    return words.map(function (w, i) {
      var bare = w.replace(/[^A-Za-z0-9&']/g, '');
      var lower = bare.toLowerCase();
      if (TC_KEEP_LOWER[lower]) return w;
      if (bare && bare === bare.toUpperCase() && bare.length > 1 && /[A-Z]/.test(bare)) return w; // acronyms / "OK"
      var prev = i ? words[i - 1] : '';
      var fresh = i === 0 || /[—:·?!]$/.test(prev) || /[…]$/.test(prev);
      if (!fresh && (TC_SMALL[lower] || lower === '&')) return w.toLowerCase();
      if (i === words.length - 1 && TC_SMALL[lower] && !fresh) return w; // leave the tail
      return w.replace(/[A-Za-z]/, function (ch) { return ch.toUpperCase(); });
    }).join(' ');
  }

  /* ---------------------------------------------------------------- loglines */

  var LOGLINES = [
    'A {Tone} {time}: {Emo1} sits at the table with {Emo2}, and nobody says the obvious thing.',
    '{Time} {PlacePhrase}. {Emo1} arrives first; {Emo2} takes the other chair.',
    'The {time} {emo1} finally got loud enough to be heard, with {emo2} humming underneath.',
    'Between {Obj} and sleep, {emo1} settles in — {emo2} stays the night.',
    'A {Tone} chapter about {ThemLine}, told in the time it takes for tea to go cold.',
    'Somewhere between {Obj} and {ThemLine}, {emo1} does the talking and {emo2} keeps the receipts.',
    'A {Tone} {time} where {ThemLine} presses against everything unsaid.'
  ];

  var WISH_LINES = [
    'A {time} entry with a clean list tucked inside: {items}.',
    'Written {time} {PlacePhrase} — the wants, said without apology: {items}.',
    'The list, exactly as it came out: {items}. Kept here so none of it stays a maybe.',
    'Not a story so much as a plan: {items}.{budget}',
    'What you are working toward, {time}: {items}.'
  ];
  function renderWishLogline(sig, seed) {
    seed = seed || 0;
    var c = contextOf(sig);
    var items = sig.wish.items.slice(0, 4).map(function (i) { return i.text.toLowerCase(); });
    if (!items.length) return renderLogline(sig, seed);
    var budget = (sig.wish.amounts && sig.wish.amounts.length) ? ' The arithmetic underneath: ' + sig.wish.amounts.join(' · ') + '.' : '';
    var ctx = Object.assign({}, c, { items: items.join(', '), budget: budget });
    var idx = Math.floor(rnd(hash(JSON.stringify(ctx) + 'wish') + seed * 23) * WISH_LINES.length) % WISH_LINES.length;
    return fill(WISH_LINES[idx], ctx);
  }

  function renderLogline(sig, seed) {
    seed = seed || 0;
    var c = contextOf(sig);
    c.Obj = c.Obj.charAt(0).toLowerCase() + c.Obj.slice(1);
    c.ThemLine = c.ThemLine;
    var e1 = sig.emotions.top[0] ? sig.emotions.top[0].id : 'calm';
    var e2 = null;
    var pool = sig.emotions.top.map(function (t) { return t.id; }).concat((sig.emotions.ranked || []).map(function (t) { return t.id; }));
    for (var pi = 0; pi < pool.length; pi++) { if (pool[pi] !== e1) { e2 = pool[pi]; break; } }
    var SHELF_NOUN = {
      joy: 'the good part of the day', heart: 'what you are still carrying',
      love: 'the people in the room', career: 'the work that never quite finishes',
      quiet: 'the shape of what you want', daily: 'the long ordinary day',
      body: 'the body keeping score', nest: 'the arithmetic of this home',
      self: 'the version of you being built', wishes: 'the list you keep in your notes'
    };
    var theme = (sig.primary && SHELF_NOUN[sig.primary.id]) ? sig.primary.id : (sig.themeIds.length ? sig.themeIds[0] : 'growth');
    var extra = {
      Tone: TONE[e1] || 'soft',
      Emo1: cap(EMO_NOUN[e1] || 'quiet'),
      Emo2: e2 ? (EMO_NOUN[e2] || 'something else') : 'silence',
      emo1: EMO_NOUN[e1] || 'quiet',
      emo2: e2 ? (EMO_NOUN[e2] || 'something else') : 'silence',
      ThemLine: SHELF_NOUN[theme] || THEME_LINE[theme] || 'the thing you keep circling'
    };
    var ctx = Object.assign({}, c, extra);
    if (extra.ThemLine && extra.ThemLine === c.obj) {
      var alt = (sig.themeIds.length && THEME_LINE[sig.themeIds[0]]) ? sig.themeIds[0] : null;
      ctx.ThemLine = (alt && THEME_LINE[alt] !== extra.ThemLine) ? THEME_LINE[alt] : 'the thing you keep circling';
    }
    var idx = Math.floor(rnd(hash(JSON.stringify(ctx) + 'log') + seed * 17) * LOGLINES.length) % LOGLINES.length;
    var line = fill(LOGLINES[idx], ctx);
    if (sig.wish.detected) {
      var items = sig.wish.items.slice(0, 4).map(function (i) { return i.text.toLowerCase(); });
      line += ' Underneath the story, a clean list waits: ' + items.join(', ') + '.';
    }
    return line;
  }

  /* --------------------------------------------------------------- highlight */

  function highlightOf(text, sig) {
    var all = sentences(text);
    var isListy = all.length > 1 && all.filter(function (l) { return /^\s*(?:[-•*]|\d+[.)])\s+/.test(l); }).length >= Math.ceil(all.length * 0.6);
    var sents = all.map(function (l) {
      return { raw: l, clean: l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim(), listy: /^\s*(?:[-•*]|\d+[.)])\s+/.test(l) };
    }).filter(function (o) { return o.clean.length > 1; });
    if (!sents.length) return '';
    var best = null;
    sents.forEach(function (o, i) {
      var s = o.clean, sc = 0;
      if (isListy && !o.listy) sc += 0; else if (isListy && o.listy) sc += 0.2;
      var low = ' ' + s.toLowerCase() + ' ';
      sig.emotions.top.forEach(function (t) {
        var g = null;
        var src = EMO[t.id];
        ['strong', 'mild'].forEach(function (w) {
          src[w].forEach(function (term) {
            var re = regexFor(term);
            re.lastIndex = 0;
            if (re.test(low)) sc += (w === 'strong' ? 3 : 1.4);
          });
        });
      });
      if (/\bi\b|\bme\b|\bmy\b/.test(low)) sc += 1.2;
      if (WISH_CUE.test(s)) sc += 1;
      if (s.length > 40 && s.length < 240) sc += 0.8;
      if (i === 0) sc += 1.1;
      if (sc > (best ? best.sc : -1)) best = { s: s, sc: sc };
    });
    var out = best ? best.s.trim() : sents[0].clean;
    if (out.length > 260) out = out.slice(0, 255).replace(/\s+\S*$/, '') + '…';
    if (out && !/[.!?…]$/.test(out)) out += '.';
    return out;
  }

  /* ------------------------------------------------------------------ analyze */

  function analyze(text, opts) {
    opts = opts || {};
    var raw = String(text || '');
    var low = ' ' + raw.toLowerCase().replace(/[’]/g, "'") + ' ';
    var wc = words(raw).length;
    var sents = sentences(raw);

    // ----- emotions
    var eScores = {}, eHits = {};
    Object.keys(EMO).forEach(function (id) {
      var g = EMO[id];
      var mild = scanGroup(low, g.mild, 1.15);
      var strong = scanGroup(low, g.strong, 2.3);
      eScores[id] = mild.score + strong.score;
      eHits[id] = mild.hits.concat(strong.hits);
    });
    var ex = (raw.match(/!/g) || []).length * 0.5 + (raw.match(/\b[A-Z]{3,}\b/g) || []).length * 0.6;
    ['anxiety', 'anger', 'joy'].forEach(function (id) { if (eScores[id] > 0) eScores[id] += ex * 0.4; });

    var ranked = Object.keys(eScores)
      .map(function (id) { return { id: id, label: EMO[id].label, color: 'var(--e-' + id + ', ' + EMO[id].color + ')', score: eScores[id] }; })
      .filter(function (o) { return o.score > 0.4; })
      .sort(function (a, b) { return b.score - a.score; });
    var maxRaw = ranked.length ? ranked[0].score : 1;
    var top3 = ranked.slice(0, 3).map(function (o) {
      return { id: o.id, label: o.label, color: 'var(--e-' + o.id + ', ' + o.color + ')', score: Math.round(o.score * 100) / 100, pct: Math.round(clamp(o.score / maxRaw, 0, 1) * 100) };
    });
    var byId = {};
    Object.keys(eScores).forEach(function (k) { byId[k] = eScores[k]; });
    var rel = {}, byId = {};
    var maxScore = ranked.length ? ranked[0].score : 1;
    Object.keys(eScores).forEach(function (k) {
      byId[k] = eScores[k];
      rel[k] = maxScore > 0 ? clamp(eScores[k] / maxScore, 0, 1) : 0;
    });
    var emotions = { scores: eScores, rel: rel, byId: byId, ranked: ranked, top: top3.length ? top3 : [{ id: 'calm', label: 'Calm', color: 'var(--e-calm, ' + EMO.calm.color + ')', score: 0, pct: 40 }] };
    Object.keys(eScores).forEach(function (k) { emotions[k] = eScores[k]; });

    // ----- physical state
    var phys = [], physWeight = 0;
    var PHYS_W = { body: 1, numb: 0.7, sleep: 0.5, move: 0.55, fuel: 0.4 };
    PHYS.forEach(function (p) {
      var hits = uniq(p.terms.filter(function (t) {
        var re = regexFor(t); re.lastIndex = 0; return re.test(low);
      }));
      if (hits.length) {
        phys.push({ id: p.id, label: p.label, terms: hits.slice(0, 4) });
        physWeight += (PHYS_W[p.id] || 0.5) * Math.min(hits.length, 3);
      }
    });

    // ----- mental state
    var mind = [], mindScores = {};
    MIND.forEach(function (m) {
      var g = scanGroup(low, m.terms, 1);
      mindScores[m.id] = g.score;
      var hits = uniq(m.terms.filter(function (t) { var re = regexFor(t); re.lastIndex = 0; return re.test(low); }));
      if (hits.length) mind.push({ id: m.id, label: m.label, terms: hits.slice(0, 4), score: Math.round(g.score * 100) / 100 });
    });

    // ----- themes
    var themes = [], themeScores = {};
    THEMES.forEach(function (t) {
      var g = scanGroup(low, t.terms, 1);
      themeScores[t.id] = g.score;
      if (g.score >= 1) themes.push({ id: t.id, label: t.label, score: Math.round(g.score * 100) / 100 });
    });
    themes.sort(function (a, b) { return b.score - a.score || 0; });
    var themeIds = {}, themeIdList = [];
    themes.forEach(function (t) { themeIds[t.id] = true; themeIdList.push(t.id); });

    // ----- entities, wishes, scores
    var entities = findEntities(raw);
    var wish = detectWishes(raw);
    var valence = valenceOf(eScores);
    var energy = clamp(0.5 + (eScores.joy * 0.10 + eScores.anger * 0.09 + eScores.hope * 0.08 + eScores.pride * 0.08 + eScores.anxiety * 0.06 - eScores.exhaustion * 0.11 - eScores.sadness * 0.06) + (wc > 60 ? 0.05 : 0), 0.05, 1);
    var clarity = clamp(0.5 + (mindScores.focus || 0) * 0.10 + (mindScores.resolve || 0) * 0.09 + (mindScores.still || 0) * 0.07 - (mindScores.fog || 0) * 0.09 - (mindScores.overwhelm || 0) * 0.07 - (mindScores.rumination || 0) * 0.08 + (energy - 0.5) * 0.15, 0.05, 1);

    var sig = {
      raw: raw, words: wc, sentenceCount: sents.length, sentences: sents,
      emotions: emotions, phys: phys, physCount: phys.length, mind: mind, mindScores: mindScores,
      themes: themes, themeIds: themeIds, themeIdList: themeIdList, themeScores: themeScores, entities: entities, wish: wish,
      valence: Math.round(valence * 100) / 100, energy: Math.round(energy * 100) / 100, clarity: Math.round(clarity * 100) / 100
    };

    // ----- thin entries (a word, a stray line) get a neutral, honest treatment
    var thin = ((ranked.length === 0 && wc < 45) || wc < 3) && !wish.detected;
    sig.thin = thin;
    if (thin) {
      sig.emotions.top = [{ id: 'calm', label: 'Calm', color: 'var(--e-calm, ' + EMO.calm.color + ')', score: 0, pct: 30 }];
      sig.entities.place = sig.entities.place || '';
    }

    // ----- shelves
    var shelves = scoreShelves(sig);
    for (var si = 0; si < shelves.length; si++) shelves[si].supported = shelfSupported(shelves[si].id, sig);
    var primary = shelves.filter(function (x) { return x.supported; })[0] || shelves[0];
    if (!wish.detected && primary.score < 1.1 && themes.length) {
      // soft fallback so a quiet entry still lands somewhere sensible
      var fallbackMap = { home: 'nest', money: 'nest', career: 'career', study: 'self', create: 'quiet', health: 'body', travel: 'quiet', faith: 'self', people: 'love', love: 'love', tech: 'daily', growth: 'self' };
      var fid = fallbackMap[themes[0].id];
      var mapped = fid && shelves.filter(function (x) { return x.id === fid; })[0];
      if (mapped && mapped.score >= primary.score * 0.8) primary = mapped;
    }
    if (thin) {
      primary = { id: 'quiet', name: SHELF_BY_ID.quiet.name, blurb: SHELF_BY_ID.quiet.blurb, score: Math.max(primary.score, 0) };
      shelves = [primary].concat(shelves.filter(function (x) { return x.id !== 'quiet'; }));
    }
    var crossFloor = Math.max(1.3, primary.score * 0.30);
    var crossLinks = shelves.filter(function (s) {
      return s.id !== primary.id && s.supported && s.score >= crossFloor;
    }).slice(0, 2);
    sig.shelves = shelves;
    sig.primary = primary;
    sig.crossLinks = crossLinks;
    sig.reason = reasonFor(primary.id, sig);
    sig.scene = sceneOf(sig);

    // ----- narrative metadata
    sig.titles = thin
      ? ['Notes From a Quiet Page', 'Nothing Loud, Everything Still', 'Between Two Thoughts'].map(function (t, i) { return { text: t, style: 'short', id: 'title-' + i + '-' + hash(t) }; })
      : generateTitles(sig, opts.style, opts.seed || 0);
    sig.logline = thin
      ? 'A nearly blank page, held open for whatever comes next — quiet, undecided, yours.'
      : (wish.detected ? renderWishLogline(sig, opts.seed || 0) : renderLogline(sig, opts.seed || 0));
    sig.highlight = thin ? '' : highlightOf(raw, sig);
    sig.phase = phaseOf(sig);
    sig.readMinutes = Math.max(1, Math.round(wc / 200));
    sig.confidence = confidenceOf(sig);
    return sig;
  }

  function phaseOf(sig) {
    var tensePast = (sig.raw.match(/\b(was|were|had|did|didn\'t|yesterday|last night|back then|used to)\b/gi) || []).length;
    var tenseFuture = (sig.raw.match(/\b(will|going to|tomorrow|next|someday|one day|plan to|soon)\b/gi) || []).length;
    var tenseNow = (sig.raw.match(/\b(am|is|are|now|today|feel|feels|feeling)\b/gi) || []).length;
    var t = tensePast > tenseFuture && tensePast > tenseNow ? 'past' : (tenseFuture > tenseNow ? 'future' : 'present');
    var mood = sig.valence > 0.35 ? 'lifting' : sig.valence < -0.35 ? 'heavy' : 'level';
    var arc = sig.mindScores.resolve > 0.9 ? 'turning' : (sig.mindScores.rumination > 0.9 ? 'circling' : (sig.wish.detected ? 'reaching' : 'holding'));
    var arcWord = { turning: 'turning', circling: 'circling', reaching: 'reaching', holding: 'steady' }[arc];
    var moodWord = { lifting: 'getting lighter', heavy: 'weighing heavy', level: 'holding even' }[mood];
    return {
      tense: t, mood: mood, arc: arc, arcWord: arcWord, moodWord: moodWord,
      label: 'a ' + arcWord + ' chapter, ' + moodWord + ' — written in the ' + t + ' tense'
    };
  }
  function confidenceOf(sig) {
    var signal = sig.emotions.ranked.length * 0.9 + sig.themes.length * 0.8 + sig.phys.length * 0.5 + sig.mind.length * 0.5 + (sig.wish.detected ? 1.6 : 0) + Math.min(sig.words / 90, 1.2);
    return Math.round(clamp(signal / 8, 0.18, 0.98) * 100);
  }

  function refinePrompt(text, request) {
    var q = String(request || '').toLowerCase();
    var style = null, say = '';
    if (/(poetic|poem|lyrical|beautiful|soft)/.test(q)) { style = 'poetic'; say = 'poetic'; }
    else if (/(cinematic|film|movie|scene|dramatic|noir)/.test(q)) { style = 'cinematic'; say = 'cinematic'; }
    else if (/(tender|warm|gentle|kind|love|sweet)/.test(q)) { style = 'tender'; say = 'tender'; }
    else if (/(wry|funny|witty|sarcastic|dry|humou?r|light)/.test(q)) { style = 'wry'; say = 'wry'; }
    else if (/(plain|simple|honest|blunt|direct|straight)/.test(q)) { style = 'plain'; say = 'plain and honest'; }
    else if (/(short|shorter|brief|tiny|two words)/.test(q)) { style = 'short'; say = 'short'; }
    var seedBump = 1;
    return { style: style, say: say || 'another angle', seedBump: seedBump };
  }

  return {
    analyze: analyze,
    generateTitles: generateTitles,
    renderLogline: renderLogline,
    refinePrompt: refinePrompt,
    SHELVES: SHELVES,
    SCENES: SCENES,
    EMOTIONS: Object.keys(EMO).map(function (k) { return { id: k, label: EMO[k].label, color: EMO[k].color }; }),
    _internal: { findItems: findItems, detectWishes: detectWishes, sentences: sentences, hash: hash }
  };
});
