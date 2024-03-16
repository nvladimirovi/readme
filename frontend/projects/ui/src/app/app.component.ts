import { HttpClient } from "@angular/common/http";
import { ChangeDetectorRef, Component } from '@angular/core';
import { MatSlideToggleChange } from "@angular/material/slide-toggle";
import * as epubjs from "epubjs";
import { BehaviorSubject, EMPTY, forkJoin, from, merge, Observable, of, Subject, Subscription, timer } from "rxjs";
import { catchError, delay, filter, finalize, map, mergeMap, take, toArray, zip } from "rxjs/operators";

const ePub: any = window["ePub"] as any;

@Component({
	selector: 'app-root',
	templateUrl: './app.component.html',
	styleUrls: ['./app.component.scss']
})
export class AppComponent {
	title = 'ui';
	fileName: string;

	book: epubjs.Book = ePub();
	openToc = false;
	rendition!: epubjs.Rendition;
	playing: boolean = false;
	playbackRate: any = Number(localStorage.getItem("playbackRate")) || 1;
	chapters: {
		label: string;
		href: string;
		subitems: epubjs.NavItem[];
	}[] = [];
	selectedChapterHref: string;

	searchQuery: string;
	searchResults: {
		cfi: string,
		excerpt: string,
	}[] = [];
	searchEnabled: boolean;
	searchSub: Subscription;

	private defaultFontSize = Number(localStorage.getItem("defaultFontSize")) || 100;
	public darkModeOn: boolean = localStorage.getItem("darkModeOn") === "true" || false;

	private audio: HTMLAudioElement;

	private currentReadTarget: HTMLElement;
	private originalReadTargetHTML: string;
	private lastReadElement: HTMLElement;
	private iframeBody: HTMLBodyElement;
	private readSubscription: Subscription;
	private contents: Element[];

	private audioControlSbj = new BehaviorSubject<boolean>(true);
	private audioControlObs = this.audioControlSbj.asObservable();

	private browserTTSUtterance: SpeechSynthesisUtterance;
	private highlightWordSubject: BehaviorSubject<string>;

	constructor(
		private http: HttpClient,
		private cdr: ChangeDetectorRef,
	) {
		this.setDarkMode();

		document.addEventListener('keydown', (event) => {
			// Check if the key pressed is "F" and "Ctrl" key is pressed simultaneously
			if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'F') {
				// Call your function here
				this.toggleSearch();

				event.preventDefault();
			}
		});
	}

	selectFile() {
		if (this.rendition) {
			this.rendition.destroy();
			this.book.destroy();
			this.openToc = false;

			this.rendition = null;
			this.book = ePub();
			this.chapters = [];
		}

		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.epub';
		input.click();

		input.onchange = async (e: any) => {
			const file: File = e.target.files[0];
			this.fileName = file.name.replace(".epub", "");
			if (window.FileReader) {
				const reader = new FileReader();
				reader.onload = this.openBook.bind(this);
				reader.readAsArrayBuffer(file);
			}
		};
	}

	play(fromContents?: Element[]) {
		if (this.readSubscription) {
			this.readSubscription.unsubscribe();
		}

		this.playing = true;

		if (!fromContents) {
			fromContents = this.contents;
		}

		// Remove duplicate text, it's cause because different html elements are wrapped in one another.
		const unique = []
		fromContents = fromContents.filter((el: HTMLElement) => {
			if (unique.includes(el.innerText)) {
				return false;
			}
			unique.push(el.innerText);
			return true;
		});

		let paragraphIndex = 0;
		this.readSubscription = from(fromContents).pipe(
			zip(
				this.audioControlObs,
				(el: HTMLElement) => {
					this.resetLastReadElement();
					paragraphIndex += 1;

					this.lastReadElement = el;

					return this.read(el);
				}
			),
			mergeMap((reading) => {
				return reading;
			}),
			map(() => {
				// TODO: Optimize, we have to TTS only new paragraphs, those that are TTS-ed doesn't need API calls.
				this.readNextNParagraphs(fromContents.slice(paragraphIndex, 2 + paragraphIndex) as HTMLElement[]);
			})
		).subscribe();
	}

	pause() {
		this.playing = false;

		try {
			window.speechSynthesis.cancel();
		} catch(e) {
			// pass
		}

		if (this.highlightWordSubject) {
			this.highlightWordSubject.complete();
		}

		if (this.currentReadTarget) {
			this.currentReadTarget.innerHTML = this.originalReadTargetHTML;
		}

		if (this.readSubscription) {
			this.resetLastReadElement();
			this.readSubscription.unsubscribe();
		}

		if (this.audio) {
			this.audio.pause();
		}
	}

	darkModeChange(data: MatSlideToggleChange) {
		this.darkModeOn = data.checked;

		localStorage.setItem("darkModeOn", this.darkModeOn as any);
		
		this.setDarkMode();
		this.setDarkModeForIframe();
	}

	selectedChapterChange(selectedChapter: string) {
		this.selectedChapterHref = selectedChapter;
		this.rendition.display(selectedChapter);
	}

	setFontSize() {
		if (!this.iframeBody) {
			return;
		}

		this.iframeBody.parentElement.style.fontSize = this.defaultFontSize + "%";
	}

	increaseFontSize() {
		if (!this.iframeBody) {
			return;
		}

		this.defaultFontSize += 5;
		this.setFontSize();

		localStorage.setItem("defaultFontSize", this.defaultFontSize.toString());
	}

	decreaseFontSize() {
		if (!this.iframeBody) {
			return;
		}

		this.defaultFontSize -= 5;
		this.setFontSize();

		localStorage.setItem("defaultFontSize", this.defaultFontSize.toString());
	}

	search(event) {
		this.searchQuery = event.target.value;

		if (!this.searchQuery) {
			this.searchResults = [];
			return;
		}

		if (this.searchSub) {
			this.searchSub.unsubscribe();
		}
		
		this.book.ready.then(() => {
			this.searchSub = of(EMPTY).pipe(
				delay(1000),
				mergeMap(() => {
					const searches: Observable<any>[] = this.book.spine["spineItems"]
					.map((item) => {
						return item.load(this.book.load.bind(this.book))
							.then(item.find.bind(item, this.searchQuery))
							.finally(item.unload.bind(item)) as Promise<any>
					})
					.map((promise) => {
						return from(promise);
					});

					return merge(
						...searches,
						10
					).pipe(
						toArray(),
						map((results: any) => {
							console.log(results);
							this.searchResults = [].concat.apply([], results);

							setTimeout(() => {
								const searchParagraphs = document.querySelectorAll(".search-p");
								searchParagraphs.forEach((p) => {
									const words = p.innerHTML.split(" ");
									p.innerHTML = "";
									words.forEach((word) => {
										if (word.toLowerCase() == this.searchQuery.toLowerCase()) {
											p.innerHTML += `<span style="background-color: var(--300);">${word} </span>`;
											return;
										}
										p.innerHTML += `${word} `;
									})
								})
							})
						})
					);
				})
			).subscribe()
		});
	}

	goToCfi(cfi: string) {
		this.rendition.display(cfi);
		this.rendition.display(cfi);
	}

	toggleSearch() {
		this.searchEnabled = !this.searchEnabled;
		this.searchQuery = null;
		this.searchResults = [];

		if (this.searchEnabled) {
			this.openToc = true;
		}
	}

	private setDarkMode() {
		localStorage.setItem("darkModeOn", this.darkModeOn.toString());
		if (this.darkModeOn) {
			document.body.classList.remove("light-theme");
		} else {
			document.body.classList.add("light-theme");
		}
	}
	
	private setDarkModeForIframe() {
		if (!this.iframeBody) {
			return;
		}

		if (this.darkModeOn) {
			const highlight = "transparent";
			const highlightHoverColor = getComputedStyle(document.documentElement).getPropertyValue('--300');

			this.iframeBody.style.setProperty("--100", highlight);
			this.iframeBody.style.setProperty("--300", highlightHoverColor);

			this.iframeBody.style.color = "papayawhip";
		} else {
			const highlight = getComputedStyle(document.documentElement).getPropertyValue('--100');
			const highlightHoverColor = getComputedStyle(document.documentElement).getPropertyValue('--300');

			this.iframeBody.style.setProperty("--100", highlight);
			this.iframeBody.style.setProperty("--300", highlightHoverColor);

			this.iframeBody.style.color = "black";
		}
	}

	private read(el: HTMLElement) {
		this.currentReadTarget = el;
		this.originalReadTargetHTML = el.innerHTML;
		el.style.background = "var(--100)";

		// Nothing to read
		if (!this.originalReadTargetHTML.length) {
			// Read next
			this.audioControlSbj.next(true);
			return EMPTY;
		}

		const voice = this.http.post("/api/tts", { bookFileName: this.fileName, text: el.innerText }, { responseType: "arraybuffer" }).pipe(
			mergeMap((voice) => {
				// TODO: Use wav files?
				// return from(this.loadAndPlayWav(voice));
				return from(this.constructVoiceAudio(voice));
			}),
			map(() => {
				localStorage.setItem("playbackRate", this.playbackRate.toString());
				this.audio.playbackRate = this.playbackRate;
				this.audio.play();

				this.highlightSpeach(el);

				if (!this.isInViewport(el)) {
					this.rendition.next();
				}
			})
		);

		return voice;
	}

	private readNextNParagraphs(nextParagraphs: HTMLElement[]) {
		(async () => {
			const requests = nextParagraphs.map((p: HTMLElement) => {
				return this.http.post("/api/tts", { bookFileName: this.fileName, text: p.innerText }, { responseType: "arraybuffer" }).pipe(
					catchError((err) => {
						return EMPTY;
					})
				);
			});

			forkJoin(requests).pipe(
				filter(Boolean),
				catchError((err) => {
					return EMPTY;
				})
			).subscribe();
		})()
	}

	private resetLastReadElement() {
		if (this.lastReadElement) {
			this.lastReadElement.style.background = "transparent";
		}
	}

	private isInViewport(element: HTMLElement) {
		const rect = element.getBoundingClientRect();
		// const isInViewport = (
		// 	rect.top >= 0 &&
		// 	rect.left >= 0 &&
		// 	rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
		// 	rect.right <= (window.innerWidth || document.documentElement.clientWidth)
		// );

		const container = document.querySelector(".epub-container");

		// If element right possition is less then the widht of the scrollable container + the applied scroll
		// then the elemnt is indeed in the scrollable view.
		const isInScrollViewport = rect.right <= (container.clientWidth + container.scrollLeft);

		return isInScrollViewport;
	}

	private openBook(e: any) {
		const bookData = e.target.result;

		this.book.open(bookData, "binary");

		this.rendition = this.book.renderTo("viewer", {
			width: "100%",
			height: 600
		});

		this.rendition.display().then(() => {
			this.getContents();
		});

		this.rendition.on("relocated", (location: string) => {
			this.getContents();
		});

		this.keepBookChapterSelectorUpToDate();

		this.registerArrowKeys();
	}

	private keepBookChapterSelectorUpToDate() {
		this.book.loaded.navigation.then((toc) => {
			this.openToc = true;
			toc.forEach((chapter) => {
				const option = document.createElement("option");
				option.textContent = chapter.label;
				option.setAttribute("ref", chapter.href);

				this.chapters.push({
					label: chapter.label,
					href: chapter.href,
					subitems: chapter.subitems
				})

				return {};
			});
		});
	}

	private getContents() {
		const iframe: HTMLIFrameElement = document.querySelector("iframe");

		const highlight = getComputedStyle(document.documentElement).getPropertyValue('--100');
		const highlightHoverColor = getComputedStyle(document.documentElement).getPropertyValue('--300');

		const mathFix = document.createElement("style");
		mathFix.innerHTML = `math {
			font-size: 1rem !important;
		}`
		iframe.contentDocument.head.appendChild(mathFix);
		iframe.contentDocument.body.style.setProperty("--100", highlight);
		iframe.contentDocument.body.style.setProperty("--300", highlightHoverColor);

		this.iframeBody = iframe.contentDocument.body as HTMLBodyElement;
		this.setFontSize();
		this.setDarkModeForIframe();
		this.contents = Array.from(iframe.contentDocument.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote"));

		this.addStartReadingFromHereListener();
	}

	private addStartReadingFromHereListener() {
		this.contents.forEach((el) => {
			el.addEventListener("mouseover", (event) => {
				const target = (event.target as HTMLElement);

				if (!["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote"].includes(target.tagName.toLowerCase())) {
					return;
				}
				target.style.background = "var(--100)";
				target.style.cursor = "pointer";
			});

			el.addEventListener("mouseleave", (event) => {
				if (this.playing && this.currentReadTarget === event.target) {
					(event.target as HTMLElement).style.background = "var(--100)";
				} else {
					(event.target as HTMLElement).style.background = "transparent";
				}
				(event.target as HTMLElement).style.cursor = "auto";
			});

			el["onclick"] = this.onClickParagraph.bind(this);
		})
	}

	private onClickParagraph(event) {
		const targetElementIndex = this.contents.findIndex((el) => el === event.target);

		const startReadFromHere = this.contents.slice(targetElementIndex);

		this.pause();
		this.play(startReadFromHere);
	}

	private registerArrowKeys() {
		const next = document.getElementById("next");
		const prev = document.getElementById("prev");

		const keyListener = (e: any) => {
			// Left Key
			if ((e.keyCode || e.which) == 37) {
				this.rendition.prev();
			}

			// Right Key
			if ((e.keyCode || e.which) == 39) {
				this.rendition.next();
			}
		};

		this.rendition.on("keyup", keyListener);

		if (!next || !prev) {
			return;
		}

		next.addEventListener("click", (e) => {
			this.rendition.next();
			e.preventDefault();
		}, false);

		prev.addEventListener("click", (e) => {
			this.rendition.prev();
			e.preventDefault();
		}, false);

		document.addEventListener("keyup", keyListener, false);
	}

	private constructVoiceAudio(voiceBuff: ArrayBuffer) {
		return (async () => {
			if (!this.audio) {
				this.audio = document.createElement('audio');
				this.audio.controls = true;

				this.audio.addEventListener("ended", () => {
					this.audioControlSbj.next(true);
				});
			}

			// document.body.appendChild(this.audio);

			// Create a MediaSource instance and connect it to video element
			const mediaSource = new MediaSource();

			// This creates a URL that points to the media buffer,
			// and assigns it to the video element src
			this.audio.src = URL.createObjectURL(mediaSource);

			// Video that will be fetched and appended
			// const remoteVidUrl = `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3`;

			// const view = new DataView(voiceBuff);
			// const blob = new Blob([view], {type: "audio/wav"});
			// voiceBuff = await blob.arrayBuffer();

			/**
			 * Before we can actually add the video, we need to:
			 *  - Create a SourceBuffer, attached to the MediaSource object
			 *  - Wait for the SourceBuffer to "open"
			 */
			/** @type {SourceBuffer} */
			const sourceBuffer: SourceBuffer = await new Promise((resolve, reject) => {
				const getSourceBuffer = () => {
					try {
						const sourceBuffer = mediaSource.addSourceBuffer(`audio/mpeg`);
						resolve(sourceBuffer);
					} catch (e) {
						reject(e);
					}
				};
				if (mediaSource.readyState === 'open') {
					getSourceBuffer();
				} else {
					mediaSource.addEventListener('sourceopen', getSourceBuffer);
				}
			});

			// Now that we have an "open" source buffer, we can append to it
			sourceBuffer.appendBuffer(voiceBuff);
			// Listen for when append has been accepted and
			// You could alternative use `.addEventListener` here instead
			sourceBuffer.onupdateend = () => {
				// Nothing else to load
				mediaSource.endOfStream();
				// Start playback!
				// Note: this will fail if video is not muted, due to rules about
				// autoplay and non-muted videos
			};
		})();
	}

	private loadAndPlayWav(arrayBuffer) {
		return (async () => {
			if (!this.audio) {
				this.audio = document.createElement('audio');
				this.audio.controls = true;

				this.audio.addEventListener("ended", () => {
					this.audioControlSbj.next(true);
				});
			}

			// Create a Blob from the ArrayBuffer
			const blob = new Blob([arrayBuffer], { type: 'audio/wav' });

			// Create a URL for the Blob
			const audioUrl = URL.createObjectURL(blob);
			
			// Set the src attribute of the audio element
			this.audio.src = audioUrl;

			// TODO: Playback speed maks the voice high pitched
			// await new Promise<void>((resolve, reject) => {
			// 	// Create a new AudioContext
			// 	const audioContext = new (window.AudioContext || window["webkitAudioContext"])();
			// 	// Decode the ArrayBuffer
			// 	audioContext.decodeAudioData(arrayBuffer, (buffer) => {
			// 		// Create a buffer source
			// 		const source: AudioBufferSourceNode = audioContext.createBufferSource();
			// 		source.buffer = buffer;
			
			// 		// Connect the buffer source to the audio context's destination (speakers)
			// 		source.connect(audioContext.destination);
					
			// 		source.playbackRate.value = 2;
			// 		// Play the audio
			// 		source.start();
			// 		// source.stop();

			// 		resolve();
			// 	});
			// });
		})();
	}

	private highlightSpeach(el: HTMLElement) {
		try {
			window.speechSynthesis.cancel();
		} catch(e) {
			// pass
		}

		if (this.highlightWordSubject) {
			this.highlightWordSubject.complete();
		}

		const highlight = (text, from, to) => {
			let replacement = highlightBackground(text.slice(from, to))
			return text.substring(0, from) + replacement + text.substring(to)
		}
		const highlightBackground = sample => `<span style="background-color: var(--300);">${sample}</span>`;
		const originalInnerHTML = el.innerHTML;
		let originalText = el.innerText;

		const useCustomHighlight = true;
		const synth = window.speechSynthesis;
		if (useCustomHighlight || !synth) {
			this.cutomHighlightSpokenWords(el, originalText, originalInnerHTML, highlight).then((subject) => {
				this.highlightWordSubject = subject;
			});
		} else {
			this.browserTTSUtterance = new SpeechSynthesisUtterance(originalText);
			this.browserTTSUtterance.addEventListener('boundary', event => {
				const { charIndex, charLength } = event;
				el.innerHTML = highlight(originalText, charIndex, charIndex + charLength);
			});
			this.browserTTSUtterance.addEventListener('end', (event) => {
				event.elapsedTime
				el.innerHTML = originalInnerHTML;
			});
			this.browserTTSUtterance.volume = 0;
			this.browserTTSUtterance.rate = 1 * this.playbackRate;
			synth.speak(this.browserTTSUtterance);
		}
	}

	private cutomHighlightSpokenWords(el: HTMLElement, originalText: string, originalInnerHTML: string, highlight: Function) {
		const words = originalText.split(" ");
		const chars = words.join();

		return new Promise<BehaviorSubject<string>>((resolve, reject) => {
			this.audio.onloadedmetadata = (event) => {
				const timePerChar = this.audio.duration / chars.length;
				
				const wordTimes = words.map((word) => {
					const timePerWord = word.length * timePerChar;
					return timePerWord;
				});
	
				const sum = wordTimes.reduce((a, b) => a + b, 0);
				const avg = sum / wordTimes.length;
				const avgVar = wordTimes.map((x) => Math.pow((x - avg), 2) ).reduce((a, b) => a + b, 0) / (wordTimes.length - 1);
	
				let fromIndex = 0;
				let index = 0;
				const wordSubject = new BehaviorSubject(words[index]);
				wordSubject.asObservable().pipe(
					mergeMap((word) => {
						el.innerHTML = highlight(originalText, fromIndex, fromIndex + word.length);
						return timer((wordTimes[index]+avgVar)*1000).pipe(
							take(1),
							map(() => {
								index += 1;
	
								if (index > words.length - 1) {
									wordSubject.complete();
									return;
								}
	
								fromIndex += word.length + 1;
								wordSubject.next(words[index])
							})
						)
					}),
					finalize(() => {
						el.innerHTML = originalInnerHTML;
					})
				).subscribe();

				resolve(wordSubject);
			}
		});
	}
}
