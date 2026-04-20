from twilio.rest import Client
import config

_client = None


def _get_client() -> Client:
    global _client
    if _client is None:
        _client = Client(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)
    return _client


def send_message(message: str) -> dict:
    msg = _get_client().messages.create(
        from_=config.TWILIO_FROM,
        to=config.USER_TO,
        body=message,
    )
    return {"sid": msg.sid, "status": msg.status}
