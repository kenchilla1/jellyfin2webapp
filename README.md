# Jellyfin Webapp

A static Jellyfin browser app served by Nginx. The container serves the app and proxies Jellyfin API, image, and media requests to the configured Jellyfin server. This keeps browser requests on the site's HTTPS origin and avoids mixed-content and cross-origin API requests.

## Unraid Deployment

1. Add the extracted source files to a GitHub repository. Uploading the ZIP as a single file will not run the image-publishing workflow.
2. On a push to the repository's default branch, GitHub Actions builds and publishes `ghcr.io/kenchilla1/jellyfin2webapp:latest`. In GitHub, make the resulting GHCR package public if Unraid should pull it without registry credentials.
3. In Unraid, add a container using `ghcr.io/kenchilla1/jellyfin2webapp:latest`. Map container port `80` to host port `8080` (or another available port).
4. Add the environment variable `JELLYFIN_SERVER` with value `http://192.168.1.155:6961`. Add `NGINX_ENVSUBST_FILTER` with value `^JELLYFIN_SERVER$`.
5. Configure the HTTPS reverse proxy for `xxx.1zero.org` to forward to the Unraid host on port `8080`. Enable WebSocket support and terminate TLS at the reverse proxy.
6. Open `https://xxx.1zero.org`. The sign-in form defaults to that site's origin and username `admin`; enter the Jellyfin password when signing in.

The reverse proxy must send requests for this domain to the webapp container. The container serves known app files and forwards other paths to `JELLYFIN_SERVER`. Do not expose the container directly to the internet without the HTTPS reverse proxy.

The Jellyfin password is not stored in this repository or image. If a real password was shared while configuring this deployment, change it before exposing the service publicly.

On supported Android browsers, the fullscreen player exposes Google Cast when a Cast receiver is available. On iPhone/iPad, use Safari's AirPlay control in the native video controls. The television must be able to reach the selected Jellyfin address.

## Local Docker

```sh
docker compose up -d --build
```

Open `http://localhost:8080`. Override `JELLYFIN_SERVER` or `PORT` in the environment when needed.