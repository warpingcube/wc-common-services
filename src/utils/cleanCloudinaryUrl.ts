export function cleanCloudinaryUrl(url: string) {
  return url
    .replace("https://res.cloudinary.com", "")
    .replace("http://res.cloudinary.com", "")
    .split("?")[0];
}
