import "yet-another-react-lightbox";

declare module "yet-another-react-lightbox" {
  interface GenericSlide {
    /** 图库图片相对路径（用于读取 PNG 信息） */
    path?: string;
    /** 文件名 */
    name?: string;
  }
}
