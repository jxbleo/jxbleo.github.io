#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const lab = require("../cloudfunctions/_shared/speaking-lab");

const ROOT = path.join(__dirname, "..");
const DEFAULT_INPUT = "/Users/jxbleo/Desktop/HKDSE_Paper4.md";
const DEFAULT_OUTPUT = path.join(ROOT, "content", "speaking", "dse-paper4-sets.json");
const PART_B_INSTRUCTION = "The examiner will ask you one or more questions based on Part A. You will have up to 1 minute to respond.";

const TITLE_CORRECTIONS = new Map(Object.entries({
  "Young people abandoning Email": "Young People Moving Away from Email",
  "Food photos": "Food Photography",
  "Street culture": "Street Culture",
  "Ferris wheel on the Central waterfront": "The Ferris Wheel on the Central Waterfront",
  "China's dinosaur": "China's Dinosaurs",
  "Common health 'mistakes'": "Common Health Mistakes",
  "Team sports": "Team Sports",
  "Financial problems tertiary students": "Financial Problems Facing Tertiary Students",
  "Should compulsory courtesy classes be introduced in Hong Kong secondary schools": "Compulsory Courtesy Classes in Hong Kong Secondary Schools",
  "Advertising does more good than harm to society": "The Social Impact of Advertising",
  "Endless City' proposal - The city in the sky": "The 'Endless City' Proposal: A City in the Sky",
  "Compulsory military service is a good idea": "Compulsory Military Service",
  "Robots into the service industry": "Robots in the Service Industry",
  "Essential items for day-to-day living": "Essential Items for Everyday Life",
  "Events organized by Dialogue Experience": "Events Organised by Dialogue Experience",
  "Charity work": "Charity Work",
  "Starting your own Business": "Starting Your Own Business",
  "Learning through play": "Learning Through Play",
  "Open Day celebration": "Open Day Celebrations",
  "Living at home with your parents when you are in your 20s": "Living with Your Parents in Your Twenties",
  "Schools replace History and Geography with Computer Programming": "Replacing History and Geography with Computer Programming",
  "Socialise after school": "Socialising after School",
  "Private kitchens": "Private Kitchens",
  "Hong Kong's buskers": "Hong Kong's Buskers",
  "Use of electronic devices": "The Use of Electronic Devices",
  "Walkable city": "A Walkable City",
  "Trophies to losing teams": "Trophies for Losing Teams",
  "Social media": "Social Media",
  "Working holidays": "Working Holidays",
  "Hong Kong streets clean": "Keeping Hong Kong's Streets Clean",
  "Message teachers": "Messaging Teachers",
  "Parent-Teacher Association meeting": "A Parent-Teacher Association Meeting",
  "Firefighter": "Firefighting as a Career",
  "Young Generation": "The Young Generation",
  "Summer job": "Summer Jobs",
  "Cashless": "A Cashless Society",
  "Wedding Photo": "Wedding Photography",
  "Online Crime": "Online Crime",
  "International Sport": "International Sport",
  "Sex Discrimination": "Sex Discrimination",
  "Densely Populated Urban Area": "Living in a Densely Populated Urban Area",
  "Unusual English Name": "Unusual English Names",
  "HKUST Campus in GuangZhou": "The HKUST Campus in Guangzhou",
  "Killing Animals": "The Killing of Animals",
  "Hong Kong Drinks": "Drinks from Hong Kong",
  "E-Lai-See": "Electronic Lai See",
  "Co-Living": "Co-living",
  "Regular Sleeping Habit": "Regular Sleeping Habits",
  "Pandemic & Fashion Industry": "The Pandemic and the Fashion Industry",
  "Student Cleaning Session": "Student Cleaning Sessions",
  "Family History & DNA": "Family History and DNA",
  "Online Transaction": "Online Transactions",
  "Fitness Classes Online": "Online Fitness Classes",
  "Storytelling & Advertisement": "Storytelling in Advertising",
  "Different View of Time": "Different Views of Time",
  "Insect Food": "Insects as Food",
  "Walking Habit": "Walking Habits",
  "Delivery apps": "Delivery Apps",
  "Ugly Buildings in Hong Kong": "Unattractive Buildings in Hong Kong",
  "Impacts of tourism to the world": "The Global Impact of Tourism",
  "Driverless tram": "Driverless Trams",
  "Multifunctional cafe": "Multifunctional Cafes",
  "Vocational Graduate School Project": "A Vocational Graduate School Project",
  "Job Online": "Finding Jobs Online",
  "Arrange a School Trip": "Planning a School Trip",
  "Harbour Race": "The Cross-Harbour Race",
  "Social media shopping": "Shopping through Social Media",
  "Hong Kong’s rice with two sides meal culture and its development": "Hong Kong's Two-dish Rice Culture",
  "Financial awareness and money‑management habits": "Financial Awareness and Money-management Habits",
  "Dishonesty on the internet": "Dishonesty on the Internet",
  "Trends in popular food and beverages influenced by social media": "Social Media Trends in Food and Drink",
  "The impact and development of online shopping": "The Growth and Impact of Online Shopping",
  "Showcasing Hong Kong cinema to international audiences": "Promoting Hong Kong Cinema Internationally",
  "The introduction of self‑driving taxis": "The Introduction of Self-driving Taxis",
  "Whether tipping should become part of Hong Kong’s service culture": "Tipping in Hong Kong's Service Culture",
  "The use of home remedies": "The Use of Home Remedies",
  "Entrepreneurship opportunities and challenges for young people": "Entrepreneurship for Young People",
  "The influence of artificial intelligence on jobs and the workplace": "Artificial Intelligence in the Workplace",
  "Making informed decisions about choosing a field of study": "Choosing a Field of Study",
  "The use of online examinations in education": "Online Examinations",
  "The relationship between money and personal happiness": "Money and Personal Happiness",
  "The growing use and impact of shared working environments": "Shared Working Environments",
  "Relationships between parents and teenagers": "Relationships between Parents and Teenagers",
  "Pen‑friend programmes and letter writing": "Pen-friend Programmes and Letter Writing",
  "Summer activities for teenagers in Hong Kong": "Summer Activities for Teenagers in Hong Kong",
  "The rise of the “ugly cute” aesthetic trend": "The Rise of the 'Ugly-cute' Aesthetic",
  "The importance of note‑taking skills in learning": "The Importance of Note-taking Skills",
  "Encouraging visits to Hong Kong’s country parks": "Encouraging Visits to Hong Kong's Country Parks",
  "Challenges and responses to an ageing population": "Responding to an Ageing Population",
  "Working opportunities for Hong Kong youth in the Greater Bay Area": "Greater Bay Area Job Opportunities for Hong Kong Youth"
}));

const PART_B_OVERRIDES = new Map(Object.entries({
  "2017:4.1": [
    "Do older people in your family enjoy singing?",
    "What do elderly people enjoy doing in their free time?",
    "What is the difference between the songs the elderly enjoy and those the young enjoy?",
    "Have you ever seen groups of elderly people singing in the park?",
    "Are there activities that are not suitable for the elderly?",
    "Why is it important for the elderly to keep busy?",
    "Why do some old people prefer to stay at home?",
    "Should retirement be something to look forward to or to worry about?"
  ]
}));

const QUESTION_CORRECTIONS = new Map(Object.entries({
  "What makes a good actor, ?": "What makes a good actor?",
  "Is change important for the future, ?": "Is change important for the future?",
  "Will virtual museums remain popular in the future, ?": "Will virtual museums remain popular in the future?",
  "Is public transportation in Hong Kong too crowded, ?": "Is public transport in Hong Kong too crowded?",
  "Are subtitles popular among teenagers, ?": "Are subtitles popular among teenagers?",
  "Can subtitles help people learn a new language, ?": "Can subtitles help people learn a new language?",
  "What effects do video games have on young people, ?": "What effects do video games have on young people?",
  "Explain How the Cross-Harbour Race Inspires Healthier Lifestyles and Promotes Fitness and Water Sports Within the Community.": "How can the Cross-Harbour Race inspire healthier lifestyles and greater interest in fitness and water sports?",
  "What ethical issues and risks are associated with online jobs, such as scams, privacy concerns, or exploitation? How can people protect themselves and make smart decisions when looking for online work?": "What risks are associated with online jobs, and how can job seekers protect themselves?",
  "What do you think about the future of online jobs in Hong Kong? Will they continue to grow, or will traditional jobs become more popular again? What factors might influence this trend?": "Will online jobs continue to grow in Hong Kong, or will traditional jobs become more popular again?",
  "List the features and advantages of different sleeping pod models. How do these features support better sleep and distinguish them from traditional sleeping arrangements?": "Which features make sleeping pods more useful than traditional sleeping arrangements?",
  "Consider Ethical Issues Like Resource Allocation, Environmental Impact, and Profit-Driven Motives. How Can These Be Balanced With the Excitement of Private Space Travel?": "How should private space travel balance excitement with environmental impact, fair use of resources and commercial interests?",
  "Imagine designing a sleeping pod specifically for business travelers or students. What features would you prioritize to meet their specific needs and preferences?": "What features would you include in a sleeping pod designed for business travellers or students?",
  "Discuss the pros and cons of sleeping pods in airports, hotels, and co-working spaces. How are they used, and why might people want them in different settings?": "What are the advantages and disadvantages of sleeping pods in airports, hotels and co-working spaces?",
  "Talk about the durability of sleeping pods. How can their design and construction promote sustainability, energy efficiency, and waste reduction?": "How can sleeping pods be made durable, energy-efficient and environmentally friendly?",
  "Can Social Media Shopping Be Environmentally Sustainable? How Can Both Businesses and Consumers Contribute to Greener Online Shopping Practices?": "How can businesses and consumers make social-media shopping more environmentally sustainable?",
  "Imagine Participating in the Cross-Harbour Race. Describe Your Training Routine, Mental Preparation, and Emotional Experience During the Event.": "How would you prepare physically and mentally for the Cross-Harbour Race?",
  "Reflect on How Private Space Travel Might Influence Society and Space Exploration. How Could It Inspire Young People to Pursue Careers in STEM?": "Could private space travel inspire more young people to pursue careers in STEM?",
  "How Can Businesses Leverage Social Media to Build Brand Awareness and Strengthen Their Online Presence? What Strategies Have Proven Effective?": "How can businesses use social media to build awareness and a stronger online presence?",
  "How Is Social Media Shopping Changing the Traditional Retail Landscape? Are Physical Stores Still Important in the Digital Shopping Era?": "Are physical shops still important as social-media shopping becomes more popular?",
  "Analyze the Impact of the Cross-Harbour Race on Local Business and Tourism. How Does Hong Kong Position Itself as a Sports Destination?": "How can the Cross-Harbour Race benefit local businesses, tourism and Hong Kong's image as a sports destination?",
  "What Role Do Influencers Play in Social Media Commerce? How Do They Influence Consumer Choices and Buying Behavior?": "How do influencers affect consumer choices in social-media shopping?"
}));

const CATEGORY_RULES = [
  ["animals", /dolphin|animal|wildlife|pet|beekeep/i],
  ["food", /food|meal|drink|restaurant|cafe|coffee|mooncake|noodle|cooking|diet|meat/i],
  ["environment", /environment|farm|green|upcycl|plastic|country park|sustain|conservation|climate|insect/i],
  ["work", /job|career|work|intern|business|entrepreneur|workplace|employment|profession|service industry/i],
  ["community", /community|family|parent|teenager|young people|society|inequality|discrimination|vulnerable|relationship|peer pressure|charity|social problem|elderly/i],
  ["culture", /culture|film|movie|music|dance|festival|museum|heritage|tradition|calligraphy|anime|comic|cantopop|celebrity|story|photo|fashion|art|theatre|cinema|dinosaur|bamboo/i],
  ["technology", /technolog|digital|online|internet|\bapp(?:s)?\b|smart|robot|drone|computer|video game|e-textbook|electronic|\bai\b|artificial intelligence|cashless|cctv|cyber|podcast|linkedin|social media|self-driving|driverless|mars|space travel|screen time|texting/i],
  ["education", /school|student|teacher|education|learning|study|classroom|textbook|exam|university|college|reading|note-taking|field of study|apprentice/i],
  ["health", /health|sleep|meditation|therapy|fitness|wellness|food|meal|drink|surgery|ageing|elderly|blood|remed|desk|walking habit/i],
  ["transport", /transport|taxi|tram|bus|bik|road|airport|travel|tour|trip|harbour|redevelopment|building|city|space|district/i],
  ["money", /money|financial|shopping|transaction|cash|coupon|price|cost|brand|consumer/i],
  ["sport", /sport|olympic|fencer|race|swim|boot camp|adventure/i],
  ["media", /advertis|media|reality show|talent show|facebook|youtube|subtitle|blog|influencer/i]
];

const CATEGORY_COPY = {
  animals: {
    value: "People's relationships with animals can support conservation, education, companionship and well-being. Direct experience may build interest and empathy when it is managed responsibly.",
    risk: "Human enjoyment must not come before an animal's welfare or the protection of its natural environment. Popular images and unusual experiences can also encourage choices that owners or organisations are not equipped to manage.",
    test: "A responsible proposal should use reliable welfare guidance, consider long-term care and explain how both people and animals will be protected."
  },
  food: {
    value: "Food choices are shaped by taste, price, convenience, health, culture and the people with whom a meal is shared. New products and habits can sit alongside traditions rather than replacing them completely.",
    risk: "A popular option may still raise concerns about nutrition, waste, working conditions or misleading promotion. What is affordable and practical for one household may not suit another.",
    test: "A balanced recommendation should consider reliable information, value for money, cultural meaning and the effect of everyday choices over time."
  },
  technology: {
    value: "Digital services can make information, communication and everyday tasks faster and more convenient. They may also widen access for people who cannot easily use a traditional service.",
    risk: "Convenience, however, can hide questions about privacy, reliability, cost and overdependence. A tool that works well for one user or task may create new difficulties for another.",
    test: "A sensible proposal should consider who controls the technology, how mistakes will be handled and whether a non-digital alternative remains available."
  },
  education: {
    value: "Educational changes often promise more engaging lessons, stronger practical skills or fairer access to learning. Their value depends on how well they support students with different needs and levels of confidence.",
    risk: "A promising idea can still place extra pressure on teachers, families or school budgets. It may also produce uneven results if training, time and equipment are not shared fairly.",
    test: "Any decision should balance learning outcomes with student well-being, realistic resources and a clear way to review whether the change is working."
  },
  health: {
    value: "Health-related choices are shaped by daily habits, personal circumstances and the information people receive. Small changes may improve well-being, but they are easier to sustain when they are practical and affordable.",
    risk: "Simple advice does not affect everyone in the same way, and confident claims can be misleading when evidence is limited. Social pressure may also turn a useful suggestion into an unrealistic expectation.",
    test: "A responsible response should distinguish personal preference from reliable guidance and consider access, safety and long-term behaviour."
  },
  environment: {
    value: "Environmental proposals ask people to think beyond immediate convenience and consider effects on shared resources, animals and future communities. Local action can also make a large issue feel more manageable.",
    risk: "Good intentions are not enough if a scheme simply shifts waste, cost or inconvenience elsewhere. Measures may fail when the public cannot understand them or when greener choices are difficult to afford.",
    test: "A workable plan needs clear responsibilities, realistic incentives and a way to measure its environmental benefit over time."
  },
  work: {
    value: "The world of work is changing as employers look for adaptable people with both knowledge and practical experience. New routes may create opportunities for young people to explore their strengths.",
    risk: "Opportunities are not automatically fair. Pay, training quality, job security and access to useful guidance can differ greatly between people and organisations.",
    test: "A good decision should consider what participants will learn, how they will be protected and whether the arrangement creates a realistic path for future development."
  },
  culture: {
    value: "Cultural activities can preserve shared memories while giving people new ways to express identity and creativity. They can also connect different generations and attract audiences who might otherwise remain uninvolved.",
    risk: "Popularity does not always lead to deeper understanding. Commercial pressure, stereotypes and a focus on quick entertainment may weaken the meaning of an activity or exclude less familiar voices.",
    test: "A strong proposal should respect the subject, make participation accessible and create reasons for people to engage rather than simply observe."
  },
  community: {
    value: "Community issues rarely affect everyone in exactly the same way. Age, income, family circumstances and access to support can shape both the problem and the solutions people consider realistic.",
    risk: "A policy designed to help may create stigma, overlook quieter groups or depend too heavily on unpaid effort. Quick solutions can also treat symptoms without addressing their causes.",
    test: "A fair response should listen to the people most affected, protect dignity and divide responsibility clearly among individuals, organisations and government."
  },
  transport: {
    value: "Movement and the design of public space influence where people can work, study and spend their free time. Improvements may increase access, safety and the attractiveness of a neighbourhood or destination.",
    risk: "Major changes can also disrupt residents, increase costs or favour visitors over local needs. Benefits may be uneven if planning focuses on speed or appearance alone.",
    test: "A balanced plan should examine safety, accessibility, environmental impact and the experience of the people who use the place every day."
  },
  money: {
    value: "Financial choices often involve more than finding the cheapest option. Convenience, trust, long-term value and the ability to compare information can all influence a decision.",
    risk: "Marketing and new payment habits may encourage impulsive choices or hide fees and risks. People with less experience or limited access to technology can be placed at a disadvantage.",
    test: "A responsible approach should make costs transparent, protect users from avoidable harm and help people make informed choices."
  },
  sport: {
    value: "Sport can improve health, confidence and teamwork while bringing communities together around a shared challenge. Different levels of participation can allow both beginners and experienced athletes to benefit.",
    risk: "Competition may also create pressure, unequal access or safety concerns. An event loses value when winning becomes more important than inclusion, learning and responsible preparation.",
    test: "A well-designed activity should set clear safety standards, welcome different abilities and define success more broadly than the final result."
  },
  media: {
    value: "Media can spread ideas quickly, shape public conversations and give individuals a platform to share work with a wide audience. It can also help organisations reach people who would be difficult to contact in other ways.",
    risk: "Attention is not the same as accuracy or value. Algorithms, commercial pressure and the desire to attract clicks can reward exaggeration and make it harder to judge what deserves trust.",
    test: "A thoughtful response should consider the source, the intended audience, the evidence provided and the effect a message may have after it is shared."
  },
  general: {
    value: "The topic involves choices that may offer clear benefits to some people while changing expectations for others. Personal experience can help explain a view, but it does not represent every situation.",
    risk: "An attractive idea may carry hidden costs, practical limits or unintended effects. Different stakeholders may also use different standards when deciding what counts as success.",
    test: "A balanced decision should compare alternatives, identify who is affected and support each recommendation with relevant reasons and examples."
  }
};

function cleanInline(value) {
  return String(value || "")
    .replace(/[\u2011\u2012\u2013]/g, "-")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMarkdown(source) {
  const heading = /^###\s+(\d{4})\s+-\s+Set\s+([0-9]+\.[0-9]+)\s+-\s+(.+)$/gm;
  const matches = Array.from(source.matchAll(heading));
  return matches.map((match, index) => {
    const block = source.slice(match.index, matches[index + 1] ? matches[index + 1].index : source.length);
    const task = block.match(/\*\*Task:\*\*\s*([^\n]+)/);
    const partASection = block.match(/#### Part A[\s\S]*?Using the practice brief above, discuss:\s*\n([\s\S]*?)\n\s*#### Part B/);
    const partBSection = block.match(/#### Part B[\s\S]*?\n\s*([\s\S]*?)(?=\n---|\n### |\n## |$)/);
    if (!task || !partASection || !partBSection) throw new Error(`Could not parse ${match[1]} Set ${match[2]}`);
    const partA = Array.from(partASection[1].matchAll(/^\s*-\s+(.+)$/gm)).map((row) => cleanInline(row[1]));
    const partB = Array.from(partBSection[1].matchAll(/^\s*\d+\.\s+(.+)$/gm)).map((row) => cleanInline(row[1]));
    if (partA.length < 3 || partB.length !== 8) throw new Error(`Unexpected question counts in ${match[1]} Set ${match[2]}: ${partA.length}/${partB.length}`);
    return {
      year: Number(match[1]),
      set_no: match[2],
      title: cleanInline(match[3]),
      task: cleanInline(task[1]),
      part_a: partA.slice(0, 3),
      part_b: partB,
      evidence: Number(match[1]) <= 2019 ? "verified_index" : "candidate_recall"
    };
  });
}

function stableChoice(values, key, salt) {
  const digest = crypto.createHash("sha256").update(`${salt}:${key}`).digest();
  return values[digest.readUInt32BE(0) % values.length];
}

function slugify(value) {
  return cleanInline(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 82).replace(/-$/g, "");
}

function categoryFor(record) {
  const titleMatch = CATEGORY_RULES.find((row) => row[1].test(record.title));
  if (titleMatch) return titleMatch[0];
  const haystack = record.part_a.join(" ");
  const match = CATEGORY_RULES.find((row) => row[1].test(haystack));
  return match ? match[0] : "general";
}

function normaliseTitle(value) {
  const cleaned = cleanInline(value);
  const corrected = TITLE_CORRECTIONS.get(value) || TITLE_CORRECTIONS.get(cleaned) || Array.from(TITLE_CORRECTIONS.entries()).find((row) => cleanInline(row[0]) === cleaned)?.[1];
  return corrected || cleaned
    .replace(/\bColor\b/g, "Colour")
    .replace(/\bOrganized\b/g, "Organised");
}

function normaliseQuestion(value) {
  let text = QUESTION_CORRECTIONS.get(value) || cleanInline(value);
  text = text
    .replace(/,\s*\?$/, "?")
    .replace(/\s+\?$/, "?")
    .replace(/\bfavorite\b/gi, (match) => match[0] === "F" ? "Favourite" : "favourite")
    .replace(/\bcolor\b/gi, (match) => match[0] === "C" ? "Colour" : "colour")
    .replace(/\borganized\b/gi, (match) => match[0] === "O" ? "Organised" : "organised")
    .replace(/\borganize\b/gi, (match) => match[0] === "O" ? "Organise" : "organise")
    .replace(/\bbehavior\b/gi, "behaviour")
    .replace(/\bbehaviors\b/gi, "behaviours")
    .replace(/\bneighborhood\b/gi, "neighbourhood")
    .replace(/\btraveling\b/gi, "travelling")
    .replace(/\btravelers\b/gi, "travellers")
    .replace(/\btraveler\b/gi, "traveller")
    .replace(/\bprioritize\b/gi, "prioritise")
    .replace(/\banalyze\b/gi, "analyse")
    .replace(/\bmarginalized\b/gi, "marginalised")
    .replace(/\bprograms\b/gi, "programmes")
    .replace(/\bpublic transportation\b/gi, "public transport")
    .replace(/\s*Please explain\.?$/i, "")
    .replace(/\s*Please explain your viewpoint\.?$/i, "")
    .trim();
  if (!/[?.!]$/.test(text)) text += "?";
  return text;
}

function normalisePoint(value) {
  return cleanInline(value)
    .replace(/\borganized\b/gi, "organised")
    .replace(/\borganize\b/gi, "organise")
    .replace(/\bcolor\b/gi, "colour")
    .replace(/[?.!]$/, "");
}

function naturalTask(record, title) {
  const task = cleanInline(record.task)
    .replace(/\bOrganize\b/g, "Organise")
    .replace(/\borganized\b/g, "organised")
    .replace(/\s*Topic:\s*"[^"]+"\.?$/i, "")
    .replace(/[.]$/, "");
  const quoted = `\u201c${title}\u201d`;
  const direct = [
    [/^Discuss$/i, `Your group is discussing ${quoted}. Discuss the following points.`],
    [/^Discuss pros and cons$/i, `Your group is discussing the advantages and disadvantages of ${quoted}. Discuss the following points.`],
    [/^Discuss a proposal$/i, `Your group is considering a proposal about ${quoted}. Discuss the following points.`],
    [/^Write a report$/i, `Your group has been asked to prepare a report about ${quoted}. Discuss the following points.`],
    [/^Write an article$/i, `Your group has been asked to prepare an article about ${quoted}. Discuss the following points.`],
    [/^Write an essay$/i, `Your group has been asked to prepare an essay about ${quoted}. Discuss the following points.`],
    [/^Write a letter(?: to the editor)?$/i, `Your group has been asked to prepare a letter about ${quoted}. Discuss the following points.`],
    [/^Give (?:a )?(?:short |class )?(?:talk|presentation)$/i, `Your group is preparing a presentation about ${quoted}. Discuss the following points.`],
    [/^Prepare (?:a |for a |a school )?(?:project|presentation|debate|discussion|talk|workshop)$/i, `Your group is preparing a group task about ${quoted}. Discuss the following points.`],
    [/^Organise (?:an? )?(?:event|festival|workshop|course|stall|campaign|activity|activities)$/i, `Your group is organising an activity connected with ${quoted}. Discuss the following points.`],
    [/^Promote (?:an activity|a scheme)$/i, `Your group is planning how to promote ${quoted}. Discuss the following points.`],
    [/^Discuss which option is suitable$/i, `Your group is choosing the most suitable option for ${quoted}. Discuss the following points.`]
  ];
  const mapped = direct.find((row) => row[0].test(task));
  if (mapped) return mapped[1];
  if (/^Discuss the main issues and possible responses connected with/i.test(task)) {
    return `Your group is discussing ${quoted}. Discuss the following points.`;
  }
  if (/^As members of /i.test(task)) {
    return `${task}. Discuss the following points.`;
  }
  const first = task.charAt(0).toLowerCase() + task.slice(1);
  const topicLink = task.length < 46 && !task.toLowerCase().includes(title.toLowerCase()) ? ` in connection with ${quoted}` : "";
  return `Your group has been asked to ${first}${topicLink}. Discuss the following points.`.replace(/\.\s*Discuss/, ". Discuss");
}

function makeContext(record, title, points) {
  const category = categoryFor({ ...record, title, part_a: points });
  const profile = CATEGORY_COPY[category] || CATEGORY_COPY.general;
  const key = `${record.year}-${record.set_no}-${title}`;
  const openings = [
    `${title} is receiving attention because it connects everyday choices with wider questions for schools, families, businesses or the community.`,
    `People may first see ${title} as a straightforward topic, yet its effects depend on who takes part, what resources are available and how success is judged.`,
    `Debate about ${title} shows how one idea can create opportunities for some people while raising practical concerns for others.`,
    `${title} can be viewed from several angles: personal experience, public interest and the practical limits of putting an idea into action.`,
    `Interest in ${title} has encouraged people to compare familiar approaches with newer possibilities. The best choice may depend on purpose, audience and circumstances.`,
    `A discussion of ${title} needs more than a quick judgement. It requires people to consider immediate benefits, possible drawbacks and longer-term effects.`
  ];
  const bridges = [
    `For this reason, examples should be examined carefully rather than treated as proof that the same approach will work for everyone.`,
    `Different groups may reasonably reach different conclusions because they face different costs, risks and responsibilities.`,
    `The strongest arguments therefore explain both who may benefit and what conditions are needed for the idea to work well.`,
    `Any recommendation should be realistic enough to carry out and flexible enough to respond when circumstances change.`
  ];
  const quotedPoints = points.map((point) => `\u201c${normalisePoint(point)}\u201d`);
  const pointSentences = [
    `The discussion should examine three connected issues: ${quotedPoints[0]}, ${quotedPoints[1]} and ${quotedPoints[2]}.`,
    `Three prompts can guide the discussion: ${quotedPoints[0]}; ${quotedPoints[1]}; and ${quotedPoints[2]}.`,
    `The group can organise its ideas around ${quotedPoints[0]}, before moving to ${quotedPoints[1]} and ${quotedPoints[2]}.`,
    `Candidates will need to respond to ${quotedPoints[0]}, explore ${quotedPoints[1]} and make a reasoned judgement about ${quotedPoints[2]}.`
  ];
  return {
    source_line: `Adapted practice article based on the ${record.year} HKDSE Paper 4 Set ${record.set_no} topic:`,
    title: stableChoice([
      `${title}: Choices and Trade-offs`,
      `A Closer Look at ${title}`,
      `${title}: What Should Be Considered?`,
      `Thinking Carefully about ${title}`
    ], key, "context-title"),
    body: [
      `${stableChoice(openings, key, "opening")} ${profile.value}`,
      `For ${title}, these possible benefits need to be weighed carefully. ${profile.risk} ${stableChoice(bridges, key, "bridge")}`,
      `${stableChoice(pointSentences, key, "points")} ${profile.test}`
    ]
  };
}

function lowerLead(value) {
  const text = normalisePoint(value);
  if (/^[A-Z]{2,}\b/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function sourceNote(record) {
  if (record.year <= 2017) {
    return `Past-paper practice for the verified ${record.year} HKDSE Paper 4 Set ${record.set_no} topic. The topic, task type and discussion points were cross-checked against public indexes or examination scans. The context article and wording are original adaptations, not a reproduction of the examination paper.`;
  }
  if (record.year <= 2019) {
    return `Past-paper practice for the ${record.year} HKDSE Paper 4 Set ${record.set_no} topic, cross-checked against public topic indexes and available candidate records. The context article and wording are original adaptations, not a reproduction of the examination paper.`;
  }
  return `Past-paper practice for the recalled ${record.year} HKDSE Paper 4 Set ${record.set_no} topic. The topic and questions were cross-checked against multiple candidate-recall sources and may differ slightly from the original examination wording. The context article is original practice material.`;
}

function buildSet(record) {
  const title = normaliseTitle(record.title);
  const points = record.part_a.map(normalisePoint);
  const version = cleanInline(record.set_no);
  const partBQuestions = PART_B_OVERRIDES.get(`${record.year}:${record.set_no}`) || record.part_b;
  const set = {
    set_id: `dse-p4-pp-${record.year}-${version.replace(".", "-")}-${slugify(title)}`,
    source_kind: "pp",
    exam_year: record.year,
    paper_version: version,
    title,
    source_note: sourceNote(record),
    context: makeContext(record, title, points),
    part_a: {
      instruction: naturalTask(record, title),
      discussion_points: [...points, "anything else you think is important"].map((text, index) => ({ point_id: `pa_${String(index + 1).padStart(2, "0")}`, order: index + 1, text }))
    },
    part_b: {
      instruction: PART_B_INSTRUCTION,
      questions: partBQuestions.map((text, index) => ({ question_id: `ir_${String(index + 1).padStart(2, "0")}`, order: index + 1, text: normaliseQuestion(text) }))
    },
    content_revision: 1,
    visible_to_students: true
  };
  return lab.normalizeSpeakingSetInput(set);
}

function words(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean);
}

function validateCorpus(sets) {
  const pp = sets.filter((set) => set.source_kind === "pp");
  const hiddenMocks = sets.filter((set) => set.source_kind === "mock" && set.visible_to_students === false);
  const ids = new Set(sets.map((set) => set.set_id));
  const identities = new Set(pp.map((set) => `${set.exam_year}:${set.paper_version}`));
  if (sets.length !== 311 || pp.length !== 306 || hiddenMocks.length !== 5 || ids.size !== sets.length || identities.size !== pp.length) {
    throw new Error(`Corpus totals failed: ${sets.length} total, ${pp.length} PP, ${hiddenMocks.length} hidden MOCK, ${ids.size} IDs, ${identities.size} identities`);
  }
  const paragraphs = new Set();
  const partBSignatures = new Set();
  for (const set of pp) {
    const body = set.context.body.join(" ");
    const count = words(body).length;
    if (count < 115 || count > 230) throw new Error(`${set.set_id} context word count is ${count}`);
    if (set.part_a.discussion_points.length !== 4 || set.part_b.questions.length !== 8) throw new Error(`${set.set_id} has incorrect Part A/B counts`);
    const signature = set.part_b.questions.map((row) => row.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).join("|");
    if (partBSignatures.has(signature)) throw new Error(`${set.set_id} repeats another Set's complete Part B question list`);
    partBSignatures.add(signature);
    if (/in your (?:view|opinion)/i.test(JSON.stringify(set.part_b.questions))) throw new Error(`${set.set_id} retains a redundant opinion prefix`);
    if (/,\s*\?|\s+\?/.test(JSON.stringify(set))) throw new Error(`${set.set_id} contains malformed question punctuation`);
    if (/A student group is preparing|This adapted practice brief focuses/i.test(body)) throw new Error(`${set.set_id} retains the old meta brief`);
    for (const paragraph of set.context.body) {
      if (paragraphs.has(paragraph)) throw new Error(`${set.set_id} contains a duplicate Context paragraph`);
      paragraphs.add(paragraph);
    }
  }
}

function renderMarkdown(records, sets) {
  const byIdentity = new Map(sets.filter((set) => set.source_kind === "pp").map((set) => [`${set.exam_year}:${set.paper_version}`, set]));
  const lines = [
    "# HKDSE English Language Paper 4 历年全 Set 整理（2012-2026）",
    "",
    "> 生产版：306 个历年 Set。Context 均为原创改编练习材料；不逐字转载试卷。",
    "",
    "## 重要说明",
    "",
    "- 保留 Year、Set 编号、主题、Task 类型、Part A 讨论点及 Part B 题意结构。",
    "- 2012-2019 以公开索引及可用扫描卷交叉核对；2023-2026 主要依据多来源考生回忆，字眼可能与原卷略有差异。",
    "- 2020-2022 的 English Speaking Examination 正式取消，因此没有真实 Set。",
    "- 每篇 Context 为版权合规的原创练习文章，并非考试原文。",
    ""
  ];
  let currentYear = null;
  for (const record of records) {
    const set = byIdentity.get(`${record.year}:${record.set_no}`);
    if (currentYear !== record.year) {
      currentYear = record.year;
      lines.push(`## ${currentYear} HKDSE English Paper 4`, "");
    }
    lines.push(
      `### PP ${set.exam_year} Set ${set.paper_version} — ${set.title}`,
      "",
      `**Set ID:** \`${set.set_id}\``,
      "",
      set.source_note,
      "",
      "#### Context",
      "",
      `**${set.context.title}**`,
      "",
      `_${set.context.source_line}_`,
      ""
    );
    set.context.body.forEach((paragraph) => lines.push(paragraph, ""));
    lines.push("#### Part A - Group Discussion", "", set.part_a.instruction, "");
    set.part_a.discussion_points.forEach((point) => lines.push(`- ${point.text}`));
    lines.push("", "#### Part B - Individual Response", "");
    set.part_b.questions.forEach((question, index) => lines.push(`${index + 1}. ${question.text}`));
    lines.push("", "---", "");
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT, markdownOutput: "" };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--input") args.input = path.resolve(argv[++index]);
    else if (key === "--output") args.output = path.resolve(argv[++index]);
    else if (key === "--markdown-output") args.markdownOutput = path.resolve(argv[++index]);
    else if (key === "--check") args.check = true;
    else throw new Error(`Unknown argument: ${key}`);
  }
  return args;
}

function run() {
  const args = parseArgs(process.argv);
  const records = parseMarkdown(fs.readFileSync(args.input, "utf8"));
  if (records.length !== 306) throw new Error(`Expected 306 Sets, found ${records.length}`);
  const oldMocks = JSON.parse(fs.readFileSync(DEFAULT_OUTPUT, "utf8")).filter((set) => set.source_kind === "mock").map((set) => ({ ...set, visible_to_students: false }));
  if (oldMocks.length !== 5) throw new Error(`Expected five existing MOCK Sets, found ${oldMocks.length}`);
  const generated = records.map(buildSet);
  const sets = [...generated, ...oldMocks].sort((left, right) => Number(right.exam_year) - Number(left.exam_year) || String(left.paper_version || "").localeCompare(String(right.paper_version || ""), undefined, { numeric: true }) || left.title.localeCompare(right.title));
  validateCorpus(sets);
  if (!args.check) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(sets, null, 2)}\n`);
    if (args.markdownOutput) fs.writeFileSync(args.markdownOutput, `${renderMarkdown(records, sets)}\n`);
  }
  const counts = Object.fromEntries([...new Set(generated.map((set) => set.exam_year))].map((year) => [year, generated.filter((set) => set.exam_year === year).length]));
  console.log(JSON.stringify({ total: sets.length, visible_pp: generated.length, hidden_mock: oldMocks.length, years: counts, output: args.check ? null : args.output, markdown_output: args.markdownOutput || null }, null, 2));
}

run();
