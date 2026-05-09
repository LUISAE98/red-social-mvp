"use client";

import React, { useEffect, useState, type ComponentType } from "react";

type CropArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SafeCropperProps = {
  image: string;
  crop: { x: number; y: number };
  zoom: number;
  aspect: number;
  cropShape?: "rect" | "round";
  showGrid?: boolean;
  rotation?: number;
  minZoom?: number;
  maxZoom?: number;
  zoomSpeed?: number;
  onCropChange: (crop: { x: number; y: number }) => void;
  onZoomChange: (zoom: number) => void;
  onCropComplete: (croppedArea: CropArea, croppedAreaPixels: CropArea) => void;
};

export default function SafeCropper(props: SafeCropperProps) {
  const [CropperComponent, setCropperComponent] =
    useState<ComponentType<SafeCropperProps> | null>(null);

  useEffect(() => {
    let mounted = true;

    import("react-easy-crop").then((mod) => {
      if (!mounted) return;
      setCropperComponent(() => mod.default as unknown as ComponentType<SafeCropperProps>);
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (!CropperComponent) {
    return null;
  }

  return <CropperComponent {...props} />;
}