export type SceneId = 'title' | 'island' | 'lab' | 'library' | 'profile';

export interface Nav {
  /** Move to a scene. `from` is the element that was clicked; the camera zooms towards it. */
  go: (to: SceneId, from?: Element | null) => void;
  /** Leave the profile page and return to wherever the player came from. */
  back: () => void;
}
