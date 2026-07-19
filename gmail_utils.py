"""
Import-safe Gmail helpers, extracted from email_interaction.py.

Unlike the original script, importing this module has NO side effects —
it does not authenticate, run a search, or set up any external client.
Call gmail_authenticate() explicitly when you're ready to connect.
"""
import os
import pickle
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
from googleapiclient.discovery import build
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from base64 import urlsafe_b64decode, b64encode, urlsafe_b64encode
from google import genai
from pydantic import BaseModel, Field
from tenacity import retry, wait_fixed, stop_after_delay


# Full Gmail access, matching the original script. Narrow this to
# 'https://www.googleapis.com/auth/gmail.readonly' if you only need to fetch mail.
SCOPES = ["https://mail.google.com/"]

SUMMARY_FILE = "summaries.json"

def load_summaries():
    if not os.path.exists(SUMMARY_FILE):
        return {}

    with open(SUMMARY_FILE, "r") as f:
        return json.load(f)
    
def save_summaries(summaries):
    with open(SUMMARY_FILE, "w") as f:
        json.dump(summaries, f, indent=2)

class Summary(BaseModel):
    priority: str = Field(description="Priority level (critical, high, normal, or low)")
    summary: str = Field(description="A one sentence summary of the email")

@retry(wait=wait_fixed(5), stop=stop_after_delay(120))
def generate_summary(message):

    gemini_key = os.environ.get("gemini_key")
    client = genai.Client(api_key=gemini_key)

    response = client.models.generate_content(model="gemini-3.1-flash-lite",
                                              contents=f"""Output a priority (either 'critical', 'high', 'normal', or 'low') based on the examples below. Then, summarize this email in one sentence and format it using the following examples:
                                              Patient wants to reschedule today's appointment
                                              New patient asks about back pain and first visit
                                              Patient asks if Blue Shield covers acupuncture
                                              Vendor offering SEO service
                                              Person reports severe chest pain 

                                              Examples of priorities:
                                              Insurance, Billing, Revenue Compliance & Impact, and Hard Deadline or Forfeiture Risk emails should be labeled "critical"
                                              Emails that mention an explicit deadline, licensing or legal exposure emails, and patient care or referral pending emails should be labeled "high"
                                              Any standard administrative request, no immediate deadline, or routine clinic communication emails should be labeled "normal"
                                              Any posts that needs aciton should not be labeled as "low"
                                              Any simply informational or newsletter emails, no action required emails, or emails that can be deferred to end of week should be labeled "low"

                                              Output in the format:
                                              priority
                                              summary
                                              
                                              {message}""",
                                              config ={
                                                  "response_mime_type": "application/json",
                                                  "response_schema": Summary
                                              })
    
    output = json.loads(response.text)
    priority = output.get("priority")
    summary = output.get("summary")

    return priority, summary

def gmail_authenticate(credentials_path="credentials.json", token_path="token.pickle"):
    """Authenticates with the Gmail API, reusing a cached token when possible."""
    creds = None
    if os.path.exists(token_path):
        with open(token_path, "rb") as token:
            creds = pickle.load(token)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_path, "wb") as token:
            pickle.dump(creds, token)
    return build("gmail", "v1", credentials=creds)

def get_latest_message(thread):
    messages = thread.get("messages", [])

    if not messages:
        return None

    return max(
    messages,
    key=lambda m: int(m.get("internalDate", 0))
)

def is_sent_by_me(message):
    return "SENT" in message.get("labelIds", [])


def search_messages(service, query):
    """Returns every message reference (id/threadId) matching a Gmail search query."""
    threads = []
    #replied = get_replied_ids()

    result = service.users().threads().list(userId="me", q=query, maxResults=25).execute()

    while True:
        for thread_ref in result.get("threads", []):

            try:
                thread = service.users().threads().get(
                    userId="me",
                    id=thread_ref["id"],
                    format="full"
                ).execute()

                latest = get_latest_message(thread)

                if latest and is_sent_by_me(latest):
                    continue

                threads.append(thread)
            except Exception as e:
                print(f"Skipping malformed message: {e}")
                continue
        if "nextPageToken" not in result:
            break
        page_token = result["nextPageToken"]
        result = service.users().threads().list(
            userId="me",
            q=query,
            maxResults=100,
            pageToken=page_token
        ).execute()

    return threads


def get_header(headers, name):
    """Case-insensitive lookup of a header value by name."""
    for h in headers or []:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def parse_from_header(from_header):
    """Splits a 'Name <email@x.com>' header into (name, email). Falls back gracefully."""
    match = re.match(r'^\s*"?(?P<name>[^"<]*)"?\s*<(?P<email>[^>]+)>\s*$', from_header or "")
    if match:
        name = match.group("name").strip()
        email = match.group("email").strip()
        return name or email, email
    stripped = (from_header or "").strip()
    return stripped, stripped


def message_has_attachment(payload):
    """True if the (already-fetched) message payload has any real attachment part."""
    def walk(parts):
        found = False
        for part in parts:
            if part.get("filename") and part.get("body", {}).get("attachmentId"):
                found = True
            if "parts" in part and walk(part["parts"]):
                found = True
        return found

    return walk(payload.get("parts", [])) if "parts" in payload else False


def format_relative_date(date_header):
    """Returns ('Today' or 'Jul 14'-style date, 'HH:MM' time), inbox-UI style."""
    try:
        dt = parsedate_to_datetime(date_header)
    except (TypeError, ValueError):
        return "", ""
    now = datetime.now(dt.tzinfo or timezone.utc)
    time_str = dt.strftime("%H:%M")
    if dt.date() == now.date():
        return "Today", time_str
    return dt.strftime("%b %d"), time_str

def parse_message_content(service, message):
    """
    Extracts the contents of a Gmail message.

    Returns:
    {
        "text": "...",
        "html": "...",
        "inline_images": {...},
        "attachments": [...]
    }
    """

    result = {
        "text": "",
        "html": "",
        "inline_images": {},
        "attachments": []
    }

    def decode_part(part):
        body = part.get("body", {})
        data = body.get("data")

        if not data and body.get("attachmentId"):
            attachment = (
                service.users()
                .messages()
                .attachments()
                .get(
                    userId="me",
                    messageId=message["id"],
                    id=body["attachmentId"]
                )
                .execute()
            )
            data = attachment.get("data")

        if not data:
            return None

        return urlsafe_b64decode(data)

    def walk_parts(parts):
        for part in parts:
            mime_type = part.get("mimeType", "")
            filename = part.get("filename", "")

            headers = part.get("headers", [])

            content_id = None
            disposition = None

            for h in headers:
                if h["name"].lower() == "content-id":
                    content_id = h["value"].strip("<>")
                if h["name"].lower() == "content-disposition":
                    disposition = h["value"]

            body = part.get("body", {})

            # Nested multipart
            if "parts" in part:
                walk_parts(part["parts"])

            decoded = decode_part(part)

            if not decoded:
                continue

            # Text body
            if mime_type == "text/plain":
                result["text"] += decoded.decode(
                    "utf-8",
                    errors="replace"
                )

            # HTML body
            elif mime_type == "text/html":
                result["html"] += decoded.decode(
                    "utf-8",
                    errors="replace"
                )

            elif content_id:
                result["inline_images"][content_id] = {
                    "mimeType": mime_type,
                    "data": urlsafe_b64encode(decoded).decode()
                }

            # Attachments
            elif filename:
                result["attachments"].append({
                    "filename": filename,
                    "mimeType": mime_type,
                    "data": urlsafe_b64encode(decoded)
                    .decode()
                })

    payload = message.get("payload", {})

    if "parts" in payload:
        walk_parts(payload["parts"])
    else:
        decoded = decode_part(payload)

        if decoded:
            mime_type = payload.get("mimeType", "")

            if mime_type == "text/plain":
                result["text"] = decoded.decode(
                    "utf-8",
                    errors="replace"
                )

            elif mime_type == "text/html":
                result["html"] = decoded.decode(
                    "utf-8",
                    errors="replace"
                )

    return result

    
def format_images(inline_images):
    """
    Converts Gmail inline image bytes into browser-readable data URLs.
    """

    images = []

    for cid, image in inline_images.items():
        images.append({
            "id": cid,
            "filename": image.get("filename"),
            "mimeType": image.get("mimeType"),
            "url": (
                f"data:{image['mimeType']};base64,"
                f"{b64encode(image['bytes']).decode('utf-8')}"
            )
        })

    return images

def format_attachments(attachments):
    formatted = []

    for attachment in attachments:
        formatted.append({
            "filename": attachment["filename"],
            "mimeType": attachment["mimeType"],
            "data": b64encode(attachment["bytes"]).decode("utf-8")
        })

    return formatted

def extract_only_text(payload):
    if 'parts' in payload:
        plain_text_parts = []
        html_text_parts = []
        
        for part in payload['parts']:
            mime_type = part.get('mimeType')
            filename = part.get('filename')
            
            # Recurse if this part contains nested sub-parts
            if 'parts' in part:
                nested_text = extract_only_text(part)
                if nested_text:
                    plain_text_parts.append(nested_text)
            
            # Skip any parts that are actual file attachments
            elif filename:
                continue
                
            # Extract plain text
            elif mime_type == 'text/plain':
                body_data = part.get('body', {}).get('data', '')
                if body_data:
                    decoded = urlsafe_b64decode(body_data).decode('utf-8', errors='ignore')
                    plain_text_parts.append(decoded)
                    
            # Extract HTML as a backup option
            elif mime_type == 'text/html':
                body_data = part.get('body', {}).get('data', '')
                if body_data:
                    decoded = urlsafe_b64decode(body_data).decode('utf-8', errors='ignore')
                    html_text_parts.append(decoded)
                    
        combined_output = []
        
        if plain_text_parts:
            combined_output.append("\n".join(plain_text_parts))
            
        if html_text_parts:
            from bs4 import BeautifulSoup
            raw_html = "\n".join(html_text_parts)
            clean_html_text = BeautifulSoup(raw_html, "html.parser").get_text(separator="\n")
            
            # De-duplicate: only add HTML text if it isn't already captured in plain text
            if clean_html_text.strip() not in "".join(plain_text_parts):
                combined_output.append(clean_html_text)
                
        return "\n\n".join(combined_output)
            
    # Case 2: Simple, single-part email (no attachments or alternative formats)
    else:
        body_data = payload.get('body', {}).get('data', '')
        if body_data:
            return urlsafe_b64decode(body_data).decode('utf-8', errors='ignore')
            
    return ""