
import logging
import sys

logger = logging.getLogger("voice_ai")


def configure_logging():
    """Configure stdout logging for serverless deployment."""

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True,
    )

    return logger


def log_event(event_name: str, **kwargs):
    """Log structured application events."""

    level = kwargs.pop("level", logging.INFO)

    logger.log(
        level,
        "%s | %s",
        event_name,
        kwargs if kwargs else "",
    )
