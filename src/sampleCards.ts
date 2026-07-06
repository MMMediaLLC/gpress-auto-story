import path from "node:path";
import sharp from "sharp";
import { getConfig } from "./config.js";
import { generateStoryCard, StoryCardPost } from "./storyRenderer.js";
import { ensureDir } from "./utils.js";

type SampleImageSpec = {
  fileName: string;
  width: number;
  height: number;
  label: string;
  colors: [string, string];
};

const sampleDir = path.resolve(process.cwd(), "work/sample-images");

const imageSpecs: SampleImageSpec[] = [
  {
    fileName: "wide-16x9.jpg",
    width: 1600,
    height: 900,
    label: "Wide 16:9",
    colors: ["#8ab4f8", "#eef6ff"]
  },
  {
    fileName: "square-1x1.jpg",
    width: 1200,
    height: 1200,
    label: "Square 1:1",
    colors: ["#a7d8b8", "#f3fff6"]
  },
  {
    fileName: "portrait-4x5.jpg",
    width: 1080,
    height: 1350,
    label: "Portrait 4:5",
    colors: ["#f0b27a", "#fff7ef"]
  },
  {
    fileName: "tall-9x16.jpg",
    width: 1080,
    height: 1920,
    label: "Tall 9:16",
    colors: ["#7285f4", "#f7f8ff"]
  }
];

export async function generateSampleCards(): Promise<string[]> {
  const config = getConfig();
  await ensureDir(sampleDir);

  const images = await Promise.all(imageSpecs.map(createSampleImage));
  const posts: StoryCardPost[] = [
    {
      id: "sample-short",
      title: "Гостивар добива нов мост",
      link: "https://gostivarpress.mk/test",
      date: "2026-07-06T12:00:00",
      category: "Гостивар",
      featuredImageUrl: images[0],
      excerpt: "Проектот ќе го подобри движењето низ градот и ќе отвори нова сообраќајна врска."
    },
    {
      id: "sample-medium",
      title: "Започна реконструкција на повеќе улици во централното градско подрачје",
      link: "https://gostivarpress.mk/test",
      date: "2026-07-06T12:00:00",
      category: "Македонија",
      featuredImageUrl: images[1],
      excerpt: "Општинските служби најавуваат фазна реализација и посебен режим на движење."
    },
    {
      id: "sample-long",
      title: "Гостиварските ученици со високи резултати на државниот натпревар по природни науки и математика",
      link: "https://gostivarpress.mk/test",
      date: "2026-07-06T12:00:00",
      category: "Образование",
      featuredImageUrl: images[2],
      excerpt: "Менторите велат дека успехот е резултат на континуирана работа и силна поддршка."
    },
    {
      id: "sample-extra-long",
      title: "Во наредните денови се очекува променливо облачно време со повремени врнежи, засилен ветер и пад на дневните температури во полошкиот регион",
      link: "https://gostivarpress.mk/test",
      date: "2026-07-06T12:00:00",
      category: "Време",
      featuredImageUrl: images[3]
    },
    {
      id: "sample-fallback",
      title: "Нема фотографија за објавата, но картичката мора да остане брендирана и читлива",
      link: "https://gostivarpress.mk/test",
      date: "2026-07-06T12:00:00",
      category: "Вести",
      featuredImageUrl: null,
      excerpt: "Fallback изгледот користи светла GPRESS палета и суптилен воден жиг."
    }
  ];

  const outputPaths: string[] = [];
  for (const post of posts) {
    outputPaths.push(await generateStoryCard(post, config));
  }

  return outputPaths;
}

async function createSampleImage(spec: SampleImageSpec): Promise<string> {
  const filePath = path.join(sampleDir, spec.fileName);
  const svg = `<svg width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${spec.colors[0]}"/>
      <stop offset="100%" stop-color="${spec.colors[1]}"/>
    </linearGradient>
    <pattern id="grid" width="96" height="96" patternUnits="userSpaceOnUse">
      <path d="M 96 0 L 0 0 0 96" fill="none" stroke="rgba(11,19,32,0.12)" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#grid)" opacity="0.55"/>
  <circle cx="${spec.width * 0.22}" cy="${spec.height * 0.28}" r="${Math.min(spec.width, spec.height) * 0.18}" fill="rgba(255,255,255,0.45)"/>
  <rect x="${spec.width * 0.46}" y="${spec.height * 0.35}" width="${spec.width * 0.34}" height="${spec.height * 0.22}" rx="24" fill="rgba(11,19,32,0.18)"/>
  <path d="M ${spec.width * 0.08} ${spec.height * 0.78} C ${spec.width * 0.28} ${spec.height * 0.60}, ${spec.width * 0.55} ${spec.height * 0.88}, ${spec.width * 0.92} ${spec.height * 0.66}" fill="none" stroke="rgba(114,133,244,0.75)" stroke-width="18" stroke-linecap="round"/>
  <text x="64" y="${spec.height - 70}" font-family="Arial, sans-serif" font-size="52" font-weight="800" fill="rgba(11,19,32,0.45)">${spec.label}</text>
</svg>`;

  await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(filePath);
  return filePath;
}
