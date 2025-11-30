# Discord ModMail Bot

Advanced ModMail bot with private threads, slash commands, and file support.

## Features
- 📩 Private thread-based tickets
- 🎫 Welcome message on ticket open
- 🔒 One-click ticket closing
- 📎 Full file/attachment support
- 🕵️ Anonymous staff replies
- 📢 Announcement system with embeds
- ⚡ Slash commands support

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```
BOT_TOKEN=your_bot_token
CLIENT_ID=your_application_id
STAFF_CHANNEL_ID=your_channel_id
```

3. Register slash commands:
```bash
npm run register
```

4. Start the bot:
```bash
npm start
```

## Commands

### Slash Commands
- `/say` - Send announcements
- `/reply` - Reply to users
- `/close` - Close tickets
- `/conversations` - View active tickets

### Text Commands
- `!reply <userid> <message>` - Reply to user
- `!close <userid>` - Close ticket
- `!conversations` - List active conversations

## Permissions Required
- Administrator (or specific permissions below)
- View Channels
- Send Messages
- Create Public Threads
- Send Messages in Threads
- Manage Threads
- Attach Files
- Add Reactions

## Support
For issues or questions, create an issue on GitHub.
*/
# ModeMail-Bot