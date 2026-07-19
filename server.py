"""
Minimal local backend that exposes your Gmail inbox to App.tsx.

Setup:
    pip install flask flask-cors google-api-python-client google-auth-oauthlib google-auth-httplib2
    # put your OAuth credentials.json in this same folder
    python server.py
    # first run opens a browser for the Gmail consent screen, then caches
    # token.pickle so future runs are silent

Runs on http://localhost:5001 — start it alongside the frontend.
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
import base64
import os
import json
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
import copy
from dotenv import load_dotenv

from gmail_utils import (
    gmail_authenticate,
    search_messages,
    get_header,
    parse_from_header,
    message_has_attachment,
    format_relative_date,
    parse_message_content,
    format_images,
    format_attachments,
    load_summaries,
    generate_summary,
    save_summaries
)

app = Flask(__name__)
CORS(app)

load_dotenv()


def get_service():
    return gmail_authenticate()


def initials_from_name(name):
    parts = [p for p in name.replace(",", " ").split() if p]
    letters = "".join(p[0] for p in parts[:2]).upper()
    return letters or "??"


def tags_from_labels(label_ids):
    skip = {"UNREAD", "INBOX", "IMPORTANT", "STARRED", "SENT", "DRAFT", "SPAM", "TRASH", "CATEGORY_PERSONAL"}
    tags = []
    for label in label_ids:
        if label in skip or label.startswith("Label_"):
            continue
        tags.append(label.replace("CATEGORY_", "").lower())
    return tags

def fetch_emails(page_token=None):
    service = get_service()
    results = service.users().messages().list(
        userId="me",
        maxResults=20,
        pageToken=page_token
    ).execute()

    return {
        "emails": results.get("messages", []),
        "nextPageToken": results.get("nextPageToken")
    }

@app.route("/emails")
def get_emails():
    page_token = request.args.get("pageToken")

    result = fetch_emails(page_token)

    return jsonify(result)


@app.route("/api/emails")
def list_emails():
    query = request.args.get("q", "-in:spam -in:trash -label:Processed")
    #max_results = int(request.args.get("max", 100))

    service = get_service()

    page_token = request.args.get("pageToken")

    result = (
        service.users()
        .threads()
        .list(
            userId="me",
            q=query,
            maxResults=20,
            pageToken=page_token
        )
        .execute()
    )

    emails = []

    summaries = load_summaries()

    base_summaries = copy.deepcopy(summaries)

    processed = get_or_create_label(service, "Processed")

    for thread_ref in result.get("threads", []):
        try:
            thread = (
                service.users()
                .threads()
                .get(
                    userId="me",
                    id=thread_ref["id"],
                    format="metadata",
        metadataHeaders=[
            "From",
            "Subject",
            "Date"
        ]
                )
                .execute()
            )

            messages = thread.get("messages", [])

            if not messages:
                continue

            latest = messages[-1]

            if processed in latest.get("labelIds", []):
                continue

            parsed_messages = []

            for msg in messages:
                headers = msg["payload"].get("headers", [])

                from_name, from_email = parse_from_header(
                    get_header(headers, "From")
                )

                label_ids = msg.get("labelIds", [])

                #content = parse_message_content(service, msg)

                message = msg

                if msg["id"] not in summaries.keys():
                    key = generate_summary(message)
                    summaries[msg["id"]] = (key[0], key[1])

                parsed_messages.append({
                    "gmailId": msg["id"],

                    "from": from_name,
                    "fromEmail": from_email,

                    "subject": get_header(headers, "Subject") or "(No subject)",

                    "preview": msg.get("snippet", ""),

                    "body": None, #content["text"],
                    "html": None, #content["html"],

                    "images": [], #content["inline_images"],
                    "attachments": [], #content["attachments"],

                    "time": format_relative_date(
                        get_header(headers, "Date")
                    ),
                    "date": get_header(headers, "Date"),

                    "priority": summaries[msg["id"]][0],

                    "read": "UNREAD" not in label_ids,
                    "starred": "STARRED" in label_ids,
                    "hasAttachment": False, #len(content["attachments"]) > 0,

                    "tags": tags_from_labels(label_ids),

                    "avatar": initials_from_name(from_name),

                    "labelIds": label_ids,
                    "summary": summaries[msg["id"]][1]
                })

            if not parsed_messages:
                continue

            emails.append({
                "threadId": thread["id"],
                "gmailId": latest["id"],
                "subject": parsed_messages[-1]["subject"],
                "starred": parsed_messages[-1]["starred"],
                "messages": parsed_messages,
            })

        except Exception as e:
            print(f"Skipping thread {thread_ref.get('id')}: {e}")

    if summaries != base_summaries:
        save_summaries(summaries)

    return jsonify({
        "emails": emails,
        "nextPageToken": result.get("nextPageToken")})

@app.route("/api/thread/<thread_id>")
def get_thread(thread_id):

    service = get_service()

    thread = (
        service.users()
        .threads()
        .get(
            userId="me",
            id=thread_id,
            format="full"
        )
        .execute()
    )

    messages = []

    for msg in thread.get("messages", []):
        headers = msg["payload"].get("headers", [])

        content = parse_message_content(service, msg)

        messages.append({
            "gmailId": msg["id"],
            "from": get_header(headers, "From"),
            "subject": get_header(headers, "Subject"),
            "date": get_header(headers, "Date"),
            "body": content["text"],
            "html": content["html"],
            "images": content["inline_images"],
            "attachments": content["attachments"]
        })

    return jsonify({"threadId": thread_id, "messages": messages})

@app.route("/api/send", methods=["POST"])
def send_email():

    email_id = request.form["email_id"]
    to = request.form["to"]
    cc = request.form["cc"]
    subject = request.form["subject"]
    body = request.form["body"]

    attachments = request.files.getlist("attachments")

    message = MIMEMultipart()

    message.attach(MIMEText(body, "html"))

    for uploaded in attachments:

        part = MIMEBase("application", "octet-stream")
        part.set_payload(uploaded.read())

        encoders.encode_base64(part)

        part.add_header(
            "Content-Disposition",
            f'attachment; filename="{uploaded.filename}"'
        )

        message.attach(part)

    service = get_service()

    message["to"] = to
    message["subject"] = subject

    if cc:
        message["cc"] = cc

    encoded_message = base64.urlsafe_b64encode(
        message.as_bytes()
    ).decode()

    sent = (
        service.users()
        .messages()
        .send(
            userId="me",
            body={"raw": encoded_message}
        )
        .execute()
    )

    # Save original email as replied
    replied = get_replied_ids()
    replied.add(email_id)
    save_replied_ids(replied)

    return jsonify({
        "success": True,
        "id": sent["id"]
    })

REPLIED_FILE = "replied.json"

def get_replied_ids():
    if not os.path.exists(REPLIED_FILE):
        return set()

    with open(REPLIED_FILE, "r") as f:
        return set(json.load(f))


def save_replied_ids(ids):
    with open(REPLIED_FILE, "w") as f:
        json.dump(list(ids), f)

def get_or_create_label(service, name):
    labels = service.users().labels().list(userId="me").execute()["labels"]

    for label in labels:
        if label["name"] == name:
            return label["id"]

    created = service.users().labels().create(
        userId="me",
        body={
            "name": name,
            "labelListVisibility": "labelShow",
            "messageListVisibility": "show"
        }
    ).execute()

    return created["id"]

@app.route("/api/replied", methods=["POST"])
def mark_replied():
    service = get_service()
    gmail_id = request.json["gmailId"]
    PROCESSED_LABEL_ID = get_or_create_label(service, "Processed")

    m = service.users().messages().modify(
        userId="me",
        id=gmail_id,
        body={
        "addLabelIds": [PROCESSED_LABEL_ID],
        "removeLabelIds": [
            "INBOX",
            "UNREAD"
        ]
    }
    ).execute()

    print(m["labelIds"])

    return jsonify({"success": True})

@app.route("/api/read/<gmail_id>", methods=["POST"])
def mark_read(gmail_id):
    service = get_service()

    service.users().threads().modify(
        userId="me",
        id=gmail_id,
        body={
            "removeLabelIds": ["UNREAD"]
        }
    ).execute()

    return jsonify({"success": True})

@app.route("/api/emails/<gmail_id>/star", methods=["POST"])
def toggle_star(gmail_id):
    service = get_service()

    print("STAR REQUEST ID:", gmail_id)

    # Get current message state
    msg = service.users().messages().get(
        userId="me",
        id=gmail_id,
        format="full"
    ).execute()

    print("MESSAGE FOUND:", msg["id"])
    print("CURRENT LABELS:", msg.get("labelIds"))

    labels = msg.get("labelIds", [])

    if "STARRED" in labels:
        print("REMOVING STAR")
        # Remove star
        service.users().messages().modify(
            userId="me",
            id=gmail_id,
            body={
                "removeLabelIds": ["STARRED"]
            }
        ).execute()

        return jsonify({"starred": False})

    else:
        print("ADDING STAR")
        # Add star
        service.users().messages().modify(
            userId="me",
            id=gmail_id,
            body={
                "addLabelIds": ["STARRED"]
            }
        ).execute()

        updated = service.users().messages().get(
        userId="me",
        id=gmail_id,
        format="full"
    ).execute()
        
        print("UPDATED LABELS:", updated.get("labelIds"))
        
        return jsonify({"starred": "STARRED" in updated.get("labelIds", [])})


if __name__ == "__main__":
    app.run(port=5001, debug=True)
