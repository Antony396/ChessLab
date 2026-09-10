class ProviderError(Exception):
    """Base class for errors raised by GameProvider implementations."""


class UserNotFoundError(ProviderError):
    def __init__(self, username: str):
        super().__init__(f"User not found: {username}")
        self.username = username
