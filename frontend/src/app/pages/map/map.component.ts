import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  Output,
  EventEmitter,
  OnDestroy
} from "@angular/core";
import { setDefaultOptions, loadModules } from 'esri-loader';
import esri = __esri;
import { WebsocketConnection } from "../../shared/websocket-connection";
import { HttpRequests } from "../../shared/http-requests";
import { BuildingsResponse } from "../../shared/responses/buildings-response.model";

@Component({
  selector: "app-esri-map",
  templateUrl: "./map.component.html",
  styleUrls: ["./map.component.scss"]
})
export class MapComponent implements OnInit, OnDestroy {
  @Output() mapLoadedEvent = new EventEmitter<boolean>();

  // The <div> where we will place the map
  @ViewChild("mapViewNode", { static: true }) private mapViewEl: ElementRef;

  // register Dojo AMD dependencies
  _Map;
  _MapView;
  _FeatureLayer;
  _Graphic;
  _GraphicsLayer;
  _Locate;
  _Route;

  // Instances
  map: esri.Map;
  view: esri.MapView;
  pointGraphic: esri.Graphic;
  graphicsLayer: esri.GraphicsLayer;

  // Attributes
  zoom = 17;
  center: Array<number> = [26.049249, 44.439862];
  basemap = "streets-vector";
  loaded = false;
  interval = null;
  location = [0, 0];

  constructor() { }

  async initializeMap() {
    try {
      // configure esri-loader to use version x from the ArcGIS CDN
      // setDefaultOptions({ version: '3.3.0', css: true });
      setDefaultOptions({ css: true });

      // Load the modules for the ArcGIS API for JavaScript
      const [
        esriConfig,
        Map,
        MapView,
        FeatureLayer,
        Graphic,
        GraphicsLayer,
        Route,
        Locator,
        RouteParameters,
        FeatureSet,
        Locate
      ] = await loadModules([
        "esri/config",
        "esri/Map",
        "esri/views/MapView",
        "esri/layers/FeatureLayer",
        "esri/Graphic",
        "esri/layers/GraphicsLayer",
        "esri/rest/route",
        "esri/rest/locator",
        "esri/rest/support/RouteParameters",
        "esri/rest/support/FeatureSet",
        "esri/widgets/Locate"
      ]);

      esriConfig.apiKey = "AAPK46bb416835724250a82b5955f095e09blM-sJFMyEUHbmgp2WHVfrYIwY3LK7vKyx8JPanN_2lsCUSdlHwUUsRMLsSF-KZN7";

      this._Map = Map;
      this._MapView = MapView;
      this._Graphic = Graphic;
      this._GraphicsLayer = GraphicsLayer;
      this._FeatureLayer = FeatureLayer;
      this._Route = Route;
      this._Locate = Locate;

      // Configure the Map
      const mapProperties = {
        basemap: this.basemap
      };

      this.map = new Map(mapProperties);

      // Initialize the MapView
      const mapViewProperties = {
        container: this.mapViewEl.nativeElement,
        center: this.center,
        zoom: this.zoom,
        map: this.map
      };

      this.view = new MapView(mapViewProperties);
      await this.view.when();

      this.view.ui.add(new Locate({
        view: this.view,
        useHeadingEnabled: false,
        goToOverride: function(view, options) {
          options.target.scale = 1500;
          return view.goTo(options.target);
        }
      }), "top-left");

      const addGraphic = (type, point) => {
        const graphic = new Graphic({
          symbol: {
            type: "simple-marker",
            color: (type === "origin") ? "white" : "black",
            size: "8px"
          },
          geometry: point
        });

        this.view.graphics.add(graphic);
      }

      const routeUrl = "https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World";

      this.view.on("click", (event) => {
        if (this.view.graphics.length >= 2) {
          this.view.graphics.removeAll();
        } else {
          addGraphic("origin", {
            type: "point",
            longitude: this.location[0],
            latitude: this.location[1]
          });
          addGraphic("destination", {
            type: "point",
            longitude: event.mapPoint.longitude,
            latitude:event.mapPoint.latitude,
          });
          getRoute();
        }
      });

      const getRoute = () => {
        const routeParams = new RouteParameters({
          stops: new FeatureSet({
            features: this.view.graphics.toArray()
          }),
        });

        this._Route.solve(routeUrl, routeParams)
          .then((data) => {
            data.routeResults.forEach((result) => {
              result.route.symbol = {
                type: "simple-line",
                color: [5, 150, 255],
                width: 3
              };
              this.view.graphics.add(result.route);
            });
          })
      };

      return this.view;
    } catch (error) {
      console.warn("EsriLoader: ", error);
    }
  }

  createMarker(color: string) {
    let c = [128, 128, 128];
    switch (color) {
      case 'bomb':
        c = [0, 0, 0];
        break;
      case 'green':
        c = [156, 202, 69];
        break;
      case 'red':
        c = [255, 0, 14];
        break;
      case 'blue':
        c = [0, 49, 249];
        break;
      case 'white':
        c = [247, 221, 182];
        break;
      case 'yellow':
        c = [233, 227, 56];
        break;
      case 'orange':
        c = [255, 162, 40];
        break;
      case 'purple':
        c = [128, 18, 125];
        break;
    }

    return {
      type: "simple-marker",
      color: c,
      outline: {
        color: [255, 255, 255],
        width: 0.5
      }
    }
  }

  addActivePlayers() {
    WebsocketConnection.setActivePlayersHandler(players => {
      this.graphicsLayer.removeAll();

      players.forEach(player => {
        const point = {
          type: "point",
          longitude: player.lon,
          latitude: player.lat
        };

        this.pointGraphic = new this._Graphic({
          geometry: point,
          symbol: this.createMarker(player.color)
        });

        this.graphicsLayer.add(this.pointGraphic);
      });
    });
  }

  async addSafeZones() {
    const buildingsResponse: BuildingsResponse = await HttpRequests.getBuildings();

    const buildingsLayer = new this._GraphicsLayer({
      opacity: 0.8
    });

    buildingsResponse.buildings.forEach(building => {
      const polygon = {
        type: "polygon",
        rings: building.points.map(point => [point[1], point[0]])
      };

      const simpleFillSymbol = {
        type: "simple-fill",
        color: building.color,
        outline: {
          color: [255, 255, 255],
          width: 1
        }
      };

      const popupTemplate = {
        title: "{Name}",
        content: "{Description}"
      }
      const attributes = {
        Name: building.name,
        Description: `Corpul ${building.name}`
      }

      const polygonGraphic = new this._Graphic({
        geometry: polygon,
        symbol: simpleFillSymbol,

        attributes: attributes,
        popupTemplate: popupTemplate
      });
      buildingsLayer.add(polygonGraphic);
    });
    this.map.add(buildingsLayer);
  }

  ngOnInit() {
    // Initialize MapView and return an instance of MapView
    this.initializeMap().then(async () => {
      // The map has been initialized
      this.loaded = this.view.ready;
      this.mapLoadedEvent.emit(true);

      this.graphicsLayer = new this._GraphicsLayer();
      this.map.add(this.graphicsLayer);

      // this is for user to give location permissions
      await new Promise(resolve => {
        navigator.geolocation.getCurrentPosition(() => resolve(null))
      })

      // send location to backend
      this.interval = setInterval(() => {
        navigator.geolocation.getCurrentPosition(res => {
          this.location = [res.coords.longitude, res.coords.latitude];
          WebsocketConnection.sendLocation(res.coords.latitude, res.coords.longitude);
        });
      }, 500);

      // update map with active players
      this.addActivePlayers();

      // update map with safezones
      await this.addSafeZones();
    });
  }

  ngOnDestroy() {
    if (this.view) {
      // destroy the map view
      this.view.container = null;
      if (this.interval) {
        clearInterval(this.interval);
      }
    }
  }
}
