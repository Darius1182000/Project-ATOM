
# Configure the project: 

- `npm install`

Not installed in the current project:
- install Chocolately: ``` Set-ExecutionPolicy Bypass -Scope Process -Force[System.Net.ServicePointManager]::SecurityProtocol = [System.NetServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https:/communitychocolatey.org/install.ps1')) ```
- install ffmpeg globally: `choco install ffmpeg -y`

# Run the project:

-  `node index.js` to run the web client

# Format (Prettier vs code):

- `CTRL + SHIFT + P` and search "Format Document"
- `SHIFT + ALT + F` to format the document you are in