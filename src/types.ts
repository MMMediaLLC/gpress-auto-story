export type PublishedStatus = "generated" | "published" | "failed";

export type StoryPost = {
  id: number;
  title: string;
  link: string;
  date: string;
  categories: string[];
  featuredImageUrl?: string;
  excerpt?: string;
};

export type PublishedRecord = {
  post_id: number;
  post_link: string;
  story_image_url?: string;
  instagram_container_id?: string;
  instagram_story_id?: string;
  status: PublishedStatus;
  published_at?: string;
  updated_at: string;
  error?: string;
};
