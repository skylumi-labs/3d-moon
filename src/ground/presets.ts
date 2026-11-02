/** A camera fixed to the module (or standing off it), by an honest on-screen name. Model space: +z front, +x left, +y up, metres. */
export interface CameraPreset {
  id: string
  /** What the button and the HUD call it. */
  name: string
  /** One line saying what is measured and what is a choice. */
  note: string
  /** Model-space eye, model-space look direction, vertical field in degrees. */
  eye: [number, number, number]
  look: [number, number, number]
  fovDeg: number
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'follow', name: 'Follow camera, front left, 20 m', note: 'A virtual camera standing off the module, front left, 4 m up. Its place is a choice.', eye: [14, 4.5, 14], look: [-14, -2.5, -14], fovDeg: 40 },
  { id: 'window', name: 'Window-height camera (no cabin, not the commander’s eye)', note: 'A virtual camera 4.5 m above the pads (about a standing crew member’s eye over the cabin floor, estimated; the model has no cabin), 0.6 m left of the centreline and just ahead of the front face, looking forward and 25 degrees down at a 62 degree field (the window’s 63.5 by 71.1 cm size, NASA TN D-7388), so the top of the frame is 6 degrees up and the Sun, 14 degrees up ahead, is out of it. The commander sat left of the centreline. No cabin is drawn and the model’s window frames are not identified, so the direction is a choice, not his view.', eye: [0.6, 4.5, 1.9], look: [0, -0.47, 1], fovDeg: 62 },
  { id: 'footpad', name: 'Footpad camera, looking up the strut', note: 'A virtual camera 0.35 m above the front-left footpad, looking along the strut to the body.', eye: [2.76, 0.45, 2.76], look: [-1.1, 1.0, -1.1], fovDeg: 75 },
  { id: 'strut', name: 'Strut camera, beside the front-left leg', note: 'A virtual camera 2.7 m beside the front-left leg and 1.6 m up, looking along the ground at the strut and its footpad. A camera inside the descent stage looking down the strut drew nothing but ground (not understood), so this one stands outside.', eye: [5.5, 1.6, 2.76], look: [-1, -0.32, 0], fovDeg: 60 },
]

