import axios from "axios";

let etag = null;
let pollInterval = 60 * 1000; // 60s
let token = null; // TODO: load token from secure storage (Keychain via keytar) or ask renderer to authenticate
let timer = null;
let locallyReadIds = new Set(); // Track notifications marked as read locally

export function setToken(t) {
  token = t;
}

// Mark a notification as read locally
export function markAsReadLocally(id) {
  locallyReadIds.add(id);
}

// Convert GitHub API URL to web URL
function convertApiUrlToHtmlUrl(notification) {
  const { subject, repository } = notification;
  const repoName = repository.full_name;

  // Handle different notification types
  if (subject.type === "PullRequest") {
    // Extract PR number from URL like: https://api.github.com/repos/owner/repo/pulls/123
    const match = subject.url.match(/pulls\/(\d+)$/);
    if (match) {
      const htmlUrl = `https://github.com/${repoName}/pull/${match[1]}`;
      return htmlUrl;
    }
  } else if (subject.type === "Issue") {
    // Extract issue number from URL
    const match = subject.url.match(/issues\/(\d+)$/);
    if (match) {
      const htmlUrl = `https://github.com/${repoName}/issues/${match[1]}`;
      return htmlUrl;
    }
  } else if (subject.type === "Commit") {
    // Extract commit SHA from URL
    const match = subject.url.match(/commits\/([a-f0-9]+)$/);
    if (match) {
      const htmlUrl = `https://github.com/${repoName}/commit/${match[1]}`;
      return htmlUrl;
    }
  } else if (subject.type === "Release") {
    // Go to releases page
    return `https://github.com/${repoName}/releases`;
  } else if (subject.type === "Discussion") {
    // Discussions don't have a simple conversion, go to discussions page
    return `https://github.com/${repoName}/discussions`;
  }

  // Fallback: go to repo
  console.log("Using fallback, going to repo");
  return `https://github.com/${repoName}`;
}

export async function fetchNotifications() {
  if (!token) return null;
  try {
    const headers = {
      Authorization: `token ${token}`,
    };
    if (etag) headers["If-None-Match"] = etag;

    // Add query parameters to ensure we only get unread notifications
    const res = await axios.get("https://api.github.com/notifications", {
      headers,
      params: {
        all: false, // Only unread notifications
        participating: false, // Include all notifications, not just participating
      },
      validateStatus: (status) => status === 200 || status === 304, // Accept both 200 and 304
    });
    if (res.status === 200) {
      etag = res.headers.etag;
      // Map to simple shape used in UI and filter out locally read notifications
      return res.data
        .filter((n) => !locallyReadIds.has(n.id)) // Exclude locally marked as read
        .map((n) => ({
          id: n.id,
          repo: n.repository,
          subject: n.subject,
          reason: n.reason,
          url: n.subject.url, // API URL
          htmlUrl: convertApiUrlToHtmlUrl(n), // Web URL
          updated_at: n.updated_at, // Timestamp for expanded view
        }));
    }
    if (res.status === 304) return null; // No new notifications
  } catch (err) {
    console.error(
      "fetchNotifications error",
      err?.response?.status,
      err?.message
    );
    return null;
  }
}

export function startPolling(onNew) {
  let last = [];
  async function tick() {
    const data = await fetchNotifications();
    if (data && data.length) {
      // naive diff: items not in last
      const lastIds = new Set(last.map((i) => i.id));
      const newItems = data.filter((i) => !lastIds.has(i.id));
      if (newItems.length) onNew(newItems);
      last = data;
    }
  }
  tick();
  timer = setInterval(tick, pollInterval);
  return () => clearInterval(timer);
}

export async function markAllRead() {
  if (!token) return;
  try {
    await axios.put(
      "https://api.github.com/notifications",
      {},
      {
        headers: {
          Authorization: `token ${token}`,
        },
      }
    );
  } catch (err) {
    console.error("markAllRead failed", err);
  }
}

// Force refresh notifications by clearing ETag cache
export async function forceRefresh() {
  etag = null; // Clear ETag to force a full fetch
  return await fetchNotifications();
}
