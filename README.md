# Jellyfin Webapp

A static Jellyfin browser app served by Nginx. The container serves the app and proxies Jellyfin API, image, and media requests to the configured Jellyfin server. This keeps browser requests on the site's HTTPS origin and avoids mixed-content and cross-origin API requests.

## Unraid Deployment

1. Add the extracted source files to a GitHub repository. Uploading the ZIP as a single file will not run the image-publishing workflow.
2. On a push to the repository's default branch, GitHub Actions builds and publishes `ghcr.io/kenchilla1/jellyfin2webapp:latest`. In GitHub, make the resulting GHCR package public if Unraid should pull it without registry credentials.
3. After `App_icon.png` and `templates/my-jellyfin2webapp.xml` are committed to the public repository, copy the Unraid template onto the server from the Unraid terminal:

```sh
wget -O /boot/config/plugins/dockerMan/templates-user/my-jellyfin2webapp.xml https://raw.githubusercontent.com/kenchilla1/jellyfin2webapp/main/templates/my-jellyfin2webapp.xml
```

4. In Unraid's Docker tab, choose **Add Container** and select `jellyfin2webapp` from the template list. The template sets the container icon to the repository's `App_icon.png`, uses network `kjgproxy`, maps host port `6960` to container port `80`, and sets the Jellyfin proxy default.
5. Configure the HTTPS reverse proxy for `x2.1zero.org` to forward to the Unraid host on port `6960`. Enable WebSocket support and terminate TLS at the reverse proxy.
6. Open `https://x2.1zero.org` and sign in with the Jellyfin account. The password is not stored in the template.

The app icon in each page header links back to the sign-in screen.

Unraid reads the displayed container icon from its Docker template. Copying the PNG into the app image alone does not change the icon for an already-created container.

The reverse proxy must send requests for this domain to the webapp container. The container serves known app files and forwards other paths to `JELLYFIN_SERVER`. Do not expose the container directly to the internet without the HTTPS reverse proxy.

The Jellyfin password is not stored in this repository or image. If a real password was shared while configuring this deployment, change it before exposing the service publicly.

On supported Android browsers, the fullscreen player exposes Google Cast when a Cast receiver is available. On iPhone/iPad, use Safari's AirPlay control in the native video controls. The television must be able to reach the selected Jellyfin address.

## Local Docker

```sh
docker compose up -d --build
```

Open `http://localhost:8080`. Override `JELLYFIN_SERVER` or `PORT` in the environment when needed.