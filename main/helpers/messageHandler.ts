import { WebContents } from 'electron';
import { logMessage } from './storeManager';

type MessageType = {
  type?: 'info' | 'error' | 'warning';
  message: string;
};

// 統一的消息發送函數
export function sendMessage(
  sender: WebContents,
  message: string | MessageType,
) {
  let messageObj: MessageType;

  if (typeof message === 'string') {
    messageObj = {
      type: message.toLowerCase().includes('error') ? 'error' : 'info',
      message,
    };
  } else {
    messageObj = message;
  }

  // 記錄到日誌系統
  logMessage(messageObj.message, messageObj.type);

  // 發送給渲染進程
  sender.send('message', messageObj.message);
}

// 用於替換原有的 event.sender.send('message', error)
export function createMessageSender(sender: WebContents) {
  return {
    send: (channel: string, message: string | MessageType) => {
      if (channel === 'message') {
        sendMessage(sender, message);
      } else {
        sender.send(channel, message);
      }
    },
  };
}
