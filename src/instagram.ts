export type InstagramPublishResult = {
  containerId: string;
  storyId: string;
};

type GraphResponse = {
  id?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

const GRAPH_BASE_URL = "https://graph.instagram.com/v23.0";

export async function publishStoryToInstagram(params: {
  igUserId: string;
  accessToken: string;
  imageUrl: string;
}): Promise<InstagramPublishResult> {
  const containerResponse = await postForm(`${GRAPH_BASE_URL}/${params.igUserId}/media`, {
    media_type: "STORIES",
    image_url: params.imageUrl,
    access_token: params.accessToken
  });

  if (!containerResponse.id) {
    throw new Error("Instagram media container response did not include an id.");
  }

  const publishResponse = await postForm(`${GRAPH_BASE_URL}/${params.igUserId}/media_publish`, {
    creation_id: containerResponse.id,
    access_token: params.accessToken
  });

  if (!publishResponse.id) {
    throw new Error("Instagram publish response did not include an id.");
  }

  return {
    containerId: containerResponse.id,
    storyId: publishResponse.id
  };
}

async function postForm(url: string, body: Record<string, string>): Promise<GraphResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body)
  });

  const json = (await response.json()) as GraphResponse;
  if (!response.ok || json.error) {
    const message = json.error?.message || `${response.status} ${response.statusText}`;
    const code = json.error?.code ? ` code ${json.error.code}` : "";
    throw new Error(`Instagram Graph API error${code}: ${message}`);
  }

  return json;
}
