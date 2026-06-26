import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'next-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Video, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Txt2SrtDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAlignStart: (videoPath: string, txtPath: string, payload: any) => void;
}

export default function Txt2SrtDialog({
  open,
  onOpenChange,
  onAlignStart,
}: Txt2SrtDialogProps) {
  const { t } = useTranslation('home');
  const [videoPath, setVideoPath] = useState<string>('');
  const [txtPath, setTxtPath] = useState<string>('');
  const [isAligning, setIsAligning] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleSelectVideo = async () => {
    try {
      const result = await window.ipc.invoke('selectFiles', {
        type: 'video',
        multiple: false,
      });
      if (result && !result.canceled && result.filePaths.length > 0) {
        setVideoPath(result.filePaths[0]);
      }
    } catch (error) {
      console.error('Failed to select video:', error);
    }
  };

  const handleSelectTxt = async () => {
    try {
      const result = await window.ipc.invoke('selectFiles', {
        type: 'txt',
        multiple: false,
      });
      if (result && !result.canceled && result.filePaths.length > 0) {
        setTxtPath(result.filePaths[0]);
      }
    } catch (error) {
      console.error('Failed to select txt:', error);
    }
  };

  const handleStartAlign = async () => {
    if (!videoPath || !txtPath) return;

    try {
      const config = await window.ipc.invoke('getUserConfig');
      const settings = await window.ipc.invoke('getSettings');

      const payload = {
        videoPath,
        txtPath,
        modelParams: {
          language: config?.sourceLanguage || 'auto',
          device: settings?.fasterWhisperDevice || 'auto',
          compute_type: settings?.fasterWhisperComputeType || 'default',
        },
      };

      onAlignStart(videoPath, txtPath, payload);
      onOpenChange(false);
    } catch (error) {
      console.error('Align preparation error:', error);
      toast.error(t('alignFailed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('txt2srtDialogTitle')}</DialogTitle>
          <DialogDescription>{t('txt2srtDialogDesc')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4 min-w-0">
          <div className="flex flex-col gap-2 min-w-0">
            <span className="text-sm font-medium">{t('videoFile')}</span>
            <div className="flex items-center gap-2 w-full min-w-0">
              <Button
                variant="outline"
                className="flex-1 justify-start h-9 min-w-0 overflow-hidden"
                onClick={handleSelectVideo}
                disabled={isAligning}
              >
                <Video className="w-4 h-4 mr-2 flex-shrink-0" />
                <span className="truncate">
                  {videoPath
                    ? videoPath.split(/[/\\]/).pop()
                    : t('selectVideo')}
                </span>
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 min-w-0">
            <span className="text-sm font-medium">{t('txtFile')}</span>
            <div className="flex items-center gap-2 w-full min-w-0">
              <Button
                variant="outline"
                className="flex-1 justify-start h-9 min-w-0 overflow-hidden"
                onClick={handleSelectTxt}
                disabled={isAligning}
              >
                <FileText className="w-4 h-4 mr-2 flex-shrink-0" />
                <span className="truncate">
                  {txtPath ? txtPath.split(/[/\\]/).pop() : t('selectTxt')}
                </span>
              </Button>
            </div>
          </div>

          {isAligning && (
            <div className="flex flex-col gap-2 mt-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t('aligning')}</span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <Progress value={progress * 100} className="h-2" />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isAligning}
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleStartAlign}
            disabled={!videoPath || !txtPath || isAligning}
          >
            {isAligning && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t('startAlign')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
